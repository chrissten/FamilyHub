import { useEffect, useState } from 'react';
import { Keyboard, Platform } from 'react-native';

/**
 * Tracks the real on-screen keyboard height via native events, rather than relying on
 * `KeyboardAvoidingView`/`android:windowSoftInputMode="adjustResize"` to resize the
 * screen automatically — inside this app's bottom-tab navigator, that automatic resize
 * doesn't reach the tab screens at all (confirmed: KeyboardAvoidingView had zero effect
 * on Grocery/To-Do/Freezer). Apply the returned height as extra bottom space on whatever
 * needs to stay above the keyboard.
 */
export function useKeyboardHeight(): number {
  const [height, setHeight] = useState(0);

  useEffect(() => {
    const showEvent = Platform.OS === 'ios' ? 'keyboardWillShow' : 'keyboardDidShow';
    const hideEvent = Platform.OS === 'ios' ? 'keyboardWillHide' : 'keyboardDidHide';
    const showSub = Keyboard.addListener(showEvent, e => setHeight(e.endCoordinates.height));
    const hideSub = Keyboard.addListener(hideEvent, () => setHeight(0));
    return () => {
      showSub.remove();
      hideSub.remove();
    };
  }, []);

  return height;
}
