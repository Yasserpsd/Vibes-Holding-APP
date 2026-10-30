<?php
/**
 * Plugin Name: Vibes lean hub path (M165)
 * Description: For /wp-json/vibes-ai/v1/hub/* calls (the Investors Club app server and n8n) only the Vibes AI Assistant, FluentSMTP and Code Snippets are loaded; the other plugins stay off for that one request. Delete this file to restore the full stack on those calls.
 * Version: 1.0.0
 *
 * Live copy: /home/vcadmin/htdocs/vcmem.com/wp-content/mu-plugins/vai-lean-hub.php (installed 2026-10-31).
 * Safe because the hub plugin keeps its own tables, fires no hooks other plugins listen to, creates no
 * WordPress users and only needs wp_mail (FluentSMTP). Re-check that list if the hub plugin ever starts
 * using WooCommerce, FluentCRM or WPML inside a hub op.
 */
if ( ! defined( 'ABSPATH' ) ) {
	exit;
}
$vai_lean_uri   = isset( $_SERVER['REQUEST_URI'] ) ? (string) $_SERVER['REQUEST_URI'] : '';
$vai_lean_route = isset( $_GET['rest_route'] ) ? (string) $_GET['rest_route'] : '';
if ( 0 === strpos( $vai_lean_uri, '/wp-json/vibes-ai/v1/hub/' ) || 0 === strpos( $vai_lean_route, '/vibes-ai/v1/hub/' ) ) {
	define( 'VAI_LEAN_HUB', true );
	add_filter(
		'option_active_plugins',
		function ( $plugins ) {
			$keep = array( 'vibes-ai-assistant/', 'fluent-smtp/', 'code-snippets/', 'code-snippets-pro/' );
			$lean = array();
			foreach ( (array) $plugins as $file ) {
				foreach ( $keep as $prefix ) {
					if ( 0 === strpos( $file, $prefix ) ) {
						$lean[] = $file;
						break;
					}
				}
			}
			return $lean;
		}
	);
}
