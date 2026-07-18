import { useEffect } from 'react';
import { DarkTheme, DefaultTheme, Stack, ThemeProvider } from 'expo-router';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { StatusBar } from 'expo-status-bar';
import { useFonts } from 'expo-font';
import * as SplashScreen from 'expo-splash-screen';
import { View } from 'react-native';
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
import { AuthProvider } from '@/lib/auth';
import { registerBackgroundNotifications } from '@/lib/backgroundNotifications';
import { registerLocationTask } from '@/lib/locationTask';
import { useLiveResponder } from '@/lib/liveLocation';
import { PlusProvider } from '@/lib/plus';
import { I18nProvider } from '@/hooks/useI18n';
import { TilePrefProvider } from '@/hooks/useTilePref';
import { useSyncNudgeWidget } from '@/hooks/useSyncNudgeWidget';
import { ThemePrefProvider, useThemePref } from '@/theme/theme-pref';
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
      {/* GLASS skin: paint the color wash behind everything and make the
          navigator's screen backgrounds transparent so it shows through. When
          GLASS is off this whole block is inert and the app is untouched. */}
      <View style={{ flex: 1 }}>
        {GLASS ? <GlassWash dark={isDark} /> : null}
        <Stack
          screenOptions={{
            headerShown: false,
            ...(GLASS ? { contentStyle: { backgroundColor: 'transparent' } } : {}),
          }}
        >
          <Stack.Screen name="paywall" options={{ presentation: 'modal' }} />
        </Stack>
      </View>
      <StatusBar style={isDark ? 'light' : 'dark'} />
    </ThemeProvider>
  );
}
