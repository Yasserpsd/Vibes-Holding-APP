import { DeleteObjectCommand, GetObjectCommand, HeadObjectCommand, ListObjectsV2Command, PutBucketCorsCommand, S3Client } from '@aws-sdk/client-s3';
import { createPresignedPost } from '@aws-sdk/s3-presigned-post';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import type { FastifyBaseLogger } from 'fastify';

import type { MediaInfo, MediaLocation, MediaObject, MediaStore, UploadTicket } from './store.js';

export type S3Options = {
  bucket: string;
  endpoint: string;
  region: string;
  accessKeyId: string;
  secretAccessKey: string;
  forcePathStyle: boolean;
  log: FastifyBaseLogger;
};

const TICKET_SECONDS = 3600;
const LINK_SECONDS = 3600;

function isMissing(error: unknown): boolean {
  if (typeof error !== 'object' || error === null) return false;
  const { name, $metadata } = error as { name?: string; $metadata?: { httpStatusCode?: number } };
  return name === 'NotFound' || name === 'NoSuchKey' || $metadata?.httpStatusCode === 404;
}

/**
 * A private S3-compatible bucket (a Railway Bucket). Browsers upload straight to it with a presigned POST
 * whose policy pins the key, the content type and the size; reads are presigned links, so neither direction
 * passes through this service (bucket egress carries no fee, service egress does).
 */
export class S3MediaStore implements MediaStore {
  readonly mode = 's3' as const;
  readonly durable = true;
  private readonly client: S3Client;
  private cors: 'pending' | 'ok' | 'failed' | 'skipped' = 'pending';

  constructor(private readonly options: S3Options) {
    this.client = new S3Client({
      region: options.region,
      endpoint: options.endpoint,
      forcePathStyle: options.forcePathStyle,
      credentials: { accessKeyId: options.accessKeyId, secretAccessKey: options.secretAccessKey },
    });
  }

  /** Lets the dashboard's origins send files to the bucket from a browser. A failure is logged, never fatal. */
  async allowOrigins(origins: string[]): Promise<void> {
    if (origins.length === 0) {
      this.cors = 'skipped';
      return;
    }
    try {
      await this.client.send(
        new PutBucketCorsCommand({
          Bucket: this.options.bucket,
          CORSConfiguration: {
            CORSRules: [{ AllowedOrigins: origins, AllowedMethods: ['POST', 'PUT'], AllowedHeaders: ['*'], ExposeHeaders: ['ETag'], MaxAgeSeconds: 3000 }],
          },
        }),
      );
      this.cors = 'ok';
    } catch (error) {
      this.cors = 'failed';
      this.options.log.error({ err: error }, 'media: could not set the bucket CORS rules, browser uploads will fail');
    }
  }

  async ticket(key: string, contentType: string, maxBytes: number): Promise<UploadTicket> {
    const { url, fields } = await createPresignedPost(this.client, {
      Bucket: this.options.bucket,
      Key: key,
      Expires: TICKET_SECONDS,
      Fields: { 'Content-Type': contentType, 'Cache-Control': 'public, max-age=31536000, immutable' },
      Conditions: [['content-length-range', 1, maxBytes]],
    });
    return { method: 'POST', url, fields };
  }

  async head(key: string): Promise<MediaInfo | null> {
    try {
      const object = await this.client.send(new HeadObjectCommand({ Bucket: this.options.bucket, Key: key }));
      return { size: object.ContentLength ?? 0, contentType: object.ContentType ?? 'application/octet-stream' };
    } catch (error) {
      if (isMissing(error)) return null;
      throw error;
    }
  }

  async locate(key: string): Promise<MediaLocation | null> {
    const redirect = await getSignedUrl(this.client, new GetObjectCommand({ Bucket: this.options.bucket, Key: key }), { expiresIn: LINK_SECONDS });
    return { redirect };
  }

  async remove(key: string): Promise<void> {
    await this.client.send(new DeleteObjectCommand({ Bucket: this.options.bucket, Key: key }));
  }

  async list(prefix: string): Promise<MediaObject[]> {
    const objects: MediaObject[] = [];
    let token: string | undefined;
    do {
      const page = await this.client.send(new ListObjectsV2Command({ Bucket: this.options.bucket, Prefix: prefix, ContinuationToken: token }));
      for (const item of page.Contents ?? []) {
        if (item.Key && item.LastModified) objects.push({ key: item.Key, modifiedAt: item.LastModified });
      }
      token = page.IsTruncated ? page.NextContinuationToken : undefined;
    } while (token);
    return objects;
  }

  status(): Record<string, unknown> {
    return { mode: this.mode, durable: this.durable, cors: this.cors, endpoint: new URL(this.options.endpoint).host };
  }
}
