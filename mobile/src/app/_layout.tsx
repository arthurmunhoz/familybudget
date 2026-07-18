import { useEffect } from 'react';
import { DarkTheme, DefaultTheme, Stack, ThemeProvider } from 'expo-router';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { StatusBar } from 'expo-status-bar';
import { useFonts } from 'expo-font';
import * as SplashScreen from 'expo-splash-screen';
import { Fraunces_600SemiBold, Fraunces_700Bold } from '@expo-google-fonts/fraunces';
import {
  HankenGrotesk_400Regular,
  HankenGrotesk_500Medium,
  HankenGrotesk_600SemiBold,
} from '@expo-google-fonts/hanken-grotesk';

import { AnalyticsBridge } from '@/components/AnalyticsBridge';
import { AuthProvider } from '@/lib/auth';
import { registerBackgroundNotifications } from '@/lib/backgroundNotifications';
import { registerLocationTask } from '@/lib/locationTask';
import { useLiveResponder } from '@/lib/liveLocation';
import { PlusProvider } from '@/lib/plus';
import { I18nProvider } from '@/hooks/useI18n';
import { TilePrefProvider } from '@/hooks/useTilePref';
import { useSyncNudgeWidget } from '@/hooks/useSyncNudgeWidget';
import { ThemePrefProvider, useThemePref } from '@/theme/theme-pref';

SplashScreen.preventAutoHideAsync().catch(() => {});

export default function RootLayout() {
  const [fontsLoaded] = useFonts({
    Fraunces_600SemiBold,
    Fraunces_700Bold,
    HankenGrotesk_400Regular,
    HankenGrotesk_500Medium,
    HankenGrotesk_600SemiBold,
  });

  useEffect(() => {
    if (fontsLoaded) SplashScreen.hideAsync().catch(() => {});
  }, [fontsLoaded]);

  // Silent-push → Nudges widget "seen by" plumbing (backgroundNotifications.ts).
  // Also registers the background-location task so the OS can wake it headlessly
  // (Whereabouts) — importing the module is what defines the task.
  useEffect(() => {
    registerBackgroundNotifications();
    registerLocationTask();
  }, []);

  if (!fontsLoaded) return null;

  return (
    <SafeAreaProvider>
      <AuthProvider>
        <PlusProvider>
          <I18nProvider>
            <ThemePrefProvider>
              <TilePrefProvider>
                <Chrome />
              </TilePrefProvider>
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
  const isDark = mode === 'dark';
  useSyncNudgeWidget();
  useLiveResponder();
  return (
    <ThemeProvider value={isDark ? DarkTheme : DefaultTheme}>
      <AnalyticsBridge />
      <Stack screenOptions={{ headerShown: false }}>
        <Stack.Screen name="paywall" options={{ presentation: 'modal' }} />
      </Stack>
      <StatusBar style={isDark ? 'light' : 'dark'} />
    </ThemeProvider>
  );
}
