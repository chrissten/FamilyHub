package expo.modules.kiosk

import android.app.ActivityManager
import android.content.Context
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
 */
class KioskModule : Module() {
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
