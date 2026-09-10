// Tracked source-of-truth for the Tauri-generated Android MainActivity.
//
// `npx tauri android init` regenerates src-tauri/gen/android/ from the vanilla
// template with a bare `class MainActivity : TauriActivity()` stub, wiping the
// customizations below. scripts/apply-android-patches.ps1 copies this file back
// in (run `npm run android:patch` after every init).
//
// If Tauri changes its MainActivity template (rare — it's just the stub above),
// re-sync any new bits here.
package com.telegram_studio.app

import android.os.Bundle
import android.webkit.WebView
import androidx.activity.enableEdgeToEdge

class MainActivity : TauriActivity() {
  override fun onCreate(savedInstanceState: Bundle?) {
    enableEdgeToEdge()
    super.onCreate(savedInstanceState)
  }

  override fun onWebViewCreate(webView: WebView) {
    super.onWebViewCreate(webView)
    // useWideViewPort must be on for the WebView to honor the viewport meta's
    // width=device-width — without it the page lays out at a desktop-ish wide
    // width instead of the phone's real CSS width. No loadWithOverviewMode:
    // that flag is what enabled the old 75% zoom-out; the viewport meta now
    // renders 1:1 (initial-scale=1.0).
    webView.settings.useWideViewPort = true
  }
}
