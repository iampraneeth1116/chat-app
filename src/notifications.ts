import Constants from 'expo-constants';
import * as Device from 'expo-device';
import * as Notifications from 'expo-notifications';
import { Platform } from 'react-native';

let activeConversationId: string | null = null;

export function setActiveConversationId(id: string | null) {
  activeConversationId = id;
}

// Configure how notifications behave when received while the app is open.
Notifications.setNotificationHandler({
  handleNotification: async (notification) => {
    const incomingConvoId = notification.request.content.data?.conversationId;
    const viewingSameChat = typeof incomingConvoId === 'string' && incomingConvoId === activeConversationId;
    return {
      shouldShowBanner: !viewingSameChat,
      shouldShowList: !viewingSameChat,
      shouldPlaySound: !viewingSameChat,
      shouldSetBadge: false,
    };
  },
});

/**
 * Ensures notification permissions & Android channel exist, then returns an Expo push token.
 * Returns null gracefully on simulators/emulators or when permissions/FCM config are unavailable.
 */
export async function registerForPushNotificationsAsync(): Promise<string | null> {
  if (Platform.OS === 'web') return null;

  try {
    if (Platform.OS === 'android') {
      await Notifications.setNotificationChannelAsync('messages', {
        name: 'Messages',
        importance: Notifications.AndroidImportance.MAX,
        vibrationPattern: [0, 250, 250, 250],
        lightColor: '#0B4F4A',
      });
    }

    if (!Device.isDevice) {
      if (__DEV__) console.log('[push] Skipping push registration on simulator/emulator');
      return null;
    }

    const { status: existingStatus } = await Notifications.getPermissionsAsync();
    let finalStatus = existingStatus;
    if (existingStatus !== 'granted') {
      const { status } = await Notifications.requestPermissionsAsync();
      finalStatus = status;
    }

    if (finalStatus !== 'granted') {
      if (__DEV__) console.log('[push] Notification permission not granted');
      return null;
    }

    const projectId =
      Constants.expoConfig?.extra?.eas?.projectId ??
      Constants.easConfig?.projectId;
    if (!projectId) {
      if (__DEV__) console.log('[push] Missing EAS projectId');
      return null;
    }

    const { data } = await Notifications.getExpoPushTokenAsync({ projectId });
    return data;
  } catch (err) {
    if (__DEV__) console.log('[push] Could not register for push notifications:', err);
    return null;
  }
}
