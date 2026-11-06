import { useEffect } from 'react';
import { DarkTheme, DefaultTheme, Stack, ThemeProvider } from 'expo-router';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { StatusBar } from 'expo-status-bar';
import { useFonts } from 'expo-font';
import * as SplashScreen from 'expo-splash-screen';
import { View } from 'react-native';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import { Fraunces_600SemiBold, Fraunces_700Bold } from '@expo-google-fonts/fraunces';
import {
  HankenGrotesk_400Regular,
  HankenGrotesk_500Medium,
  HankenGrotesk_600SemiBold,
} from '@expo-google-fonts/hanken-grotesk';
// GLASS skin fonts (rounded titles). Harmless to load when the skin is off.
import {
  Nunito_600SemiBold,
  Nunito_700Bold,
  Nunito_800ExtraBold,
} from '@expo-google-fonts/nunito';

import { AnalyticsBridge } from '@/components/AnalyticsBridge';
import { LaunchIntro } from '@/components/LaunchIntro';
import { AuthProvider } from '@/lib/auth';
import { registerBackgroundNotifications } from '@/lib/backgroundNotifications';
import { registerLocationTask } from '@/lib/locationTask';
import { useLiveResponder } from '@/lib/liveLocation';
import { registerGeofenceTask } from '@/lib/placesTask';
import { PlusProvider } from '@/lib/plus';
import { I18nProvider } from '@/hooks/useI18n';
import { AppPrefsProvider } from '@/hooks/useAppPrefs';
import { TilePrefProvider } from '@/hooks/useTilePref';
import { useSyncNudgeWidget } from '@/hooks/useSyncNudgeWidget';
import { useGeofenceSync } from '@/hooks/useGeofenceSync';
import { useLocationSync } from '@/hooks/useLocationSync';
import { useSyncPushToken } from '@/hooks/useSyncPushToken';
import { ThemePrefProvider, useThemePref } from '@/theme/theme-pref';
import { SchemePrefProvider, useSchemePref } from '@/theme/scheme-pref';
import { GLASS, GlassWash } from '@/theme/glass';

SplashScreen.preventAutoHideAsync().catch(() => {});

export default function RootLayout() {
  const [fontsLoaded] = useFonts({
    Fraunces_600SemiBold,
    Fraunces_700Bold,
    HankenGrotesk_400Regular,
    HankenGrotesk_500Medium,
    HankenGrotesk_600SemiBold,
    Nunito_600SemiBold,
    Nunito_700Bold,
    Nunito_800ExtraBold,
  });

  // The native splash is hidden by LaunchIntro on its first layout (it starts
  // identical to it, so the swap can't be seen). Failsafe: never leave the
  // splash up if that layer somehow doesn't mount.
  useEffect(() => {
    const id = setTimeout(() => SplashScreen.hideAsync().catch(() => {}), 4000);
    return () => clearTimeout(id);
  }, []);

  // Silent-push → Nudges widget "seen by" plumbing (backgroundNotifications.ts).
  // Also registers the background-location task so the OS can wake it headlessly
  // (Whereabouts) — importing the module is what defines the task.
  useEffect(() => {
    registerBackgroundNotifications();
    registerLocationTask();
    registerGeofenceTask();
  }, []);

  if (!fontsLoaded) return null;

  return (
    <SafeAreaProvider>
      <AuthProvider>
        <PlusProvider>
          <I18nProvider>
            <ThemePrefProvider>
              <SchemePrefProvider>
                <TilePrefProvider>
                  <AppPrefsProvider>
                    <Chrome />
                  </AppPrefsProvider>
                </TilePrefProvider>
              </SchemePrefProvider>
            </ThemePrefProvider>
          </I18nProvider>
        </PlusProvider>
      </AuthProvider>
    </SafeAreaProvider>
  );
}

// Navigation chrome + status bar, resolved from the saved appearance override.
// Also keeps the Nudges widget synced (useSyncNudgeWidget) — mounted here, not
// on the Nudges screen, so it fires on every app launch/login regardless of
// which screen the user actually opens.
function Chrome() {
  const { mode } = useThemePref();
  const { scheme } = useSchemePref();
  const isDark = mode === 'dark';
  useSyncNudgeWidget();
  useLiveResponder();
  // Register this device's geofences on launch/foreground, not just when the
  // Whereabouts screen is opened — see useGeofenceSync.
  useGeofenceSync();
  // Android drops background location updates when the app is terminated and
  // never restarts them on its own — see the hook.
  useLocationSync();
  // Repair a stale/rotated Expo push token on launch (never prompts).
  useSyncPushToken();
  return (
    <ThemeProvider value={isDark ? DarkTheme : DefaultTheme}>
      <AnalyticsBridge />
      {/* GLASS skin: paint the color wash behind everything and make the
          navigator's screen backgrounds transparent so it shows through. When
          GLASS is off this whole block is inert and the app is untouched. */}
      {/* The app-wide gesture root, which react-native-gesture-handler expects
          at the top of the tree. There was none: the only root on Settings was
          one wrapped around the hub-apps DraggableList INSIDE the page's
          ScrollView, and a root's recognizer can block every recognizer above it
          — the scroll view's pan included — which is how Settings could stop
          scrolling (2026-10-22). Modals still need their own (a RN <Modal> is a
          separate native hierarchy this one doesn't reach). */}
      <GestureHandlerRootView style={{ flex: 1 }}>
        {GLASS ? <GlassWash dark={isDark} scheme={scheme} /> : null}
        {/* Every screen ALSO paints its own wash (screenLayout). Transparent
            screens alone let the one underneath show through whenever both are
            in the hierarchy — and on Android 13+ the default push keeps the old
            screen fully opaque, shifted -10%, under the new one for the whole
            450 ms transition (react-native-screens' rns_default_* anims), and
            leaves it there if the transition is interrupted. A tester's Galaxy
            showed Settings drawn over the Hub exactly like that (2026-11).
            Same fix the paywall route already had: each screen is its own
            opaque backing. The root wash stays for the gaps between screens. */}
        <Stack
          screenOptions={{
            headerShown: false,
            ...(GLASS ? { contentStyle: { backgroundColor: 'transparent' } } : {}),
          }}
          screenLayout={
            GLASS
              ? ({ children }) => (
                  <View style={{ flex: 1 }}>
                    <GlassWash dark={isDark} scheme={scheme} />
                    {children}
                  </View>
                )
              : undefined
          }
        >
          <Stack.Screen name="paywall" options={{ presentation: 'modal' }} />
        </Stack>
        {/* The opening: starts identical to the native splash, animates, then
            fades into the app once the session is known (LaunchIntro). */}
        <LaunchIntro />
      </GestureHandlerRootView>
      <StatusBar style={isDark ? 'light' : 'dark'} />
    </ThemeProvider>
  );
}
