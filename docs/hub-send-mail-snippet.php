<?php
/**
 * M112 — hub mail channel: the ONE function the automated guard would not let Claude paste into
 * includes/class-vai-hub.php itself. The owner adds it (or re-runs Claude with an Edit permission
 * rule for the rig). Place: inside `class VAI_Hub`, right ABOVE `private static function op_admin_stats`.
 * The op name `send_mail` is ALREADY in trusted_ops() (2.19.0), so once this method exists the
 * app server's HubMailer starts working — trusted app-server key only, wp_mail does the sending.
 */
	private static function op_send_mail( $site, $d ) {
		$raw = isset( $d['to'] ) ? ( is_array( $d['to'] ) ? $d['to'] : array( $d['to'] ) ) : array();
		$to  = array();
		foreach ( $raw as $addr ) {
			$addr = sanitize_email( (string) $addr );
			if ( $addr && is_email( $addr ) ) {
				$to[] = $addr;
			}
		}
		$to      = array_slice( array_values( array_unique( $to ) ), 0, 10 );
		$subject = vai_str( $d, 'subject', 300 );
		$text    = isset( $d['text'] ) && is_string( $d['text'] ) ? $d['text'] : '';
		$html    = isset( $d['html'] ) && is_string( $d['html'] ) ? $d['html'] : '';
		if ( ! $to || $subject === '' || ( $text === '' && $html === '' ) ) {
			return vai_error( 'invalid', 'to و subject ونص الرسالة مطلوبة', 400 );
		}
		$headers = array();
		$body    = $text;
		if ( $html !== '' ) {
			$headers[] = 'Content-Type: text/html; charset=UTF-8';
			$body      = $html;
		}
		$sent = wp_mail( $to, $subject, $body, $headers );
		return array(
			'ok'   => true,
			'sent' => (bool) $sent,
			'to'   => count( $to ),
		);
	}
