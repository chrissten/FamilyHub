package expo.modules.kiosk

import android.app.Activity
import android.app.ActivityManager
import android.content.Context
import android.os.Build
import android.os.Handler
import android.os.Looper
import android.os.Process
import android.util.Log
import android.view.View
import android.view.WindowInsets
import android.view.WindowInsetsController
import expo.modules.kotlin.Promise
import expo.modules.kotlin.functions.Queues
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition

/**
 * Screen pinning (Android "lock task" mode) for the shared family tablet. Without
 * device-owner provisioning, startLockTask() pins the app: Home, Recents and the
 * notification shade are disabled until stopLockTask() is called from inside the app,
 * or someone does the system unpin gesture (which asks for the device PIN when
 * "Ask for PIN before unpinning" is on in Settings).
 *
 * Pinning alone still leaves the navigation bar / gesture pill on screen, so
 * setImmersive() hides it as well: a swipe from the edge only brings it back briefly.
 */
class KioskModule : Module() {
  private var immersive = false
  private val handler = Handler(Looper.getMainLooper())

  @Suppress("DEPRECATION")
  private fun applyImmersive(activity: Activity, enabled: Boolean) {
    val decor = activity.window.decorView
    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.R) {
      val controller = activity.window.insetsController
      if (controller != null) {
        if (enabled) {
          controller.systemBarsBehavior = WindowInsetsController.BEHAVIOR_SHOW_TRANSIENT_BARS_BY_SWIPE
          controller.hide(WindowInsets.Type.navigationBars())
        } else {
          controller.show(WindowInsets.Type.navigationBars())
        }
      }
    }
    // The legacy flags too: some tablet firmwares (e.g. the 12L-style taskbar) only react
    // to these. Harmless on builds that translate them into the same inset request.
    decor.systemUiVisibility = if (enabled) {
      decor.systemUiVisibility or View.SYSTEM_UI_FLAG_HIDE_NAVIGATION or
        View.SYSTEM_UI_FLAG_IMMERSIVE_STICKY
    } else {
      decor.systemUiVisibility and View.SYSTEM_UI_FLAG_HIDE_NAVIGATION.inv() and
        View.SYSTEM_UI_FLAG_IMMERSIVE_STICKY.inv()
    }
    handler.postDelayed({
      val visible = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.R) {
        decor.rootWindowInsets?.isVisible(WindowInsets.Type.navigationBars())
      } else null
      Log.d("KioskModule", "setImmersive($enabled): navigation bars visible=$visible flags=${decor.systemUiVisibility}")
    }, 800)
    // The bar slides back in after an edge swipe or when the keyboard closes; tuck it
    // away again shortly after rather than leaving it up.
    @Suppress("DEPRECATION")
    decor.setOnSystemUiVisibilityChangeListener(
      if (!enabled) null else View.OnSystemUiVisibilityChangeListener { flags ->
        if (immersive && (flags and View.SYSTEM_UI_FLAG_HIDE_NAVIGATION) == 0) {
          handler.postDelayed({ if (immersive) applyImmersive(activity, true) }, 2000)
        }
      }
    )
  }

  override fun definition() = ModuleDefinition {
    Name("Kiosk")

    Function("isLocked") {
      val am = appContext.reactContext?.getSystemService(Context.ACTIVITY_SERVICE) as? ActivityManager
      am != null && am.lockTaskModeState != ActivityManager.LOCK_TASK_MODE_NONE
    }

    AsyncFunction("lock") { promise: Promise ->
      val activity = appContext.currentActivity
      if (activity == null) {
        promise.resolve(false)
      } else {
        activity.startLockTask()
        promise.resolve(true)
      }
    }.runOnQueue(Queues.MAIN)

    AsyncFunction("setImmersive") { enabled: Boolean, promise: Promise ->
      immersive = enabled
      appContext.currentActivity?.let { applyImmersive(it, enabled) }
      promise.resolve(null)
    }.runOnQueue(Queues.MAIN)

    // Closes the app and ends its process. A plain finish() leaves the process alive, and
    // Android then reopens the activity (we are the Home app) onto a React surface that was
    // already stopped: a blank screen until the app is force-stopped.
    AsyncFunction("exitApp") { promise: Promise ->
      appContext.currentActivity?.finishAndRemoveTask()
      handler.postDelayed({ Process.killProcess(Process.myPid()) }, 400)
      promise.resolve(null)
    }.runOnQueue(Queues.MAIN)

    AsyncFunction("unlock") { promise: Promise ->
      try {
        appContext.currentActivity?.stopLockTask()
      } catch (_: IllegalStateException) {
        // Not pinned — nothing to undo.
      }
      promise.resolve(null)
    }.runOnQueue(Queues.MAIN)
  }
}
