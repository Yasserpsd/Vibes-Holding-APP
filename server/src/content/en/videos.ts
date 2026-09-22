import type { Translation } from '../i18n.js';
import type { VideosContent } from '../videos.js';

/** The video library page in English; the picks and the channel are the Arabic block's. */
export const VIDEOS_EN: Translation<VideosContent> = {
  title: 'Video library',
  intro: "Every video of the Investors Club channel on YouTube: the club's story, the meetups and the group's companies.",
  featuredTitle: 'Start here',
  featured: [
    { id: 'CnWMWS_nDpM', label: 'The story of the Investors Club' },
    { id: 'KUzcLImZc-c', label: 'More than 11,000 members' },
    { id: '3hvxhZL-gsM', label: 'How the club works' },
    { id: 'TzeJOrO4nMI', label: 'The club categories' },
    { id: 'ReJljicbEJc', label: 'The “5 minutes” meetup' },
    { id: 'xpxKMnj_Nzk', label: 'Make your meetup' },
    { id: 'vLI-G989nIk', label: 'The Seka app' },
    { id: 'XERenNWNziA', label: 'A tour of the club HQ' },
  ],
};
