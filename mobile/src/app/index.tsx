// First vertical slice of the RN rewrite: proves the whole stack end-to-end —
// Supabase auth (session persisted in AsyncStorage) → RLS-scoped read of the
// signed-in household's pets. Dev sign-in is temporary; Google OAuth + Sign in
// with Apple replace it next.
import { useCallback, useEffect, useState } from 'react';
import {
  ActivityIndicator,
  FlatList,
  Pressable,
  StyleSheet,
  Text,
  useColorScheme,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { useAuth } from '@/lib/auth';
import { supabase } from '@/lib/supabase';

const DEV_EMAIL = process.env.EXPO_PUBLIC_DEV_EMAIL ?? '';
const DEV_PASSWORD = process.env.EXPO_PUBLIC_DEV_PASSWORD ?? '';

type PetRow = { id: string; name: string; emoji: string | null; species: string | null };

// "Warm Hearth" palette (subset) — light "Paper" / dark "Dusk".
function usePalette() {
  const dark = useColorScheme() === 'dark';
  return dark
    ? { bg: '#151312', text: '#F4F1EA', muted: '#9b938c', card: '#221f1d', accent: '#c87d56' }
    : { bg: '#F4F1EA', text: '#2b2522', muted: '#7a726b', card: '#ffffff', accent: '#b5613a' };
}

export default function Home() {
  const { session, loading } = useAuth();
  const c = usePalette();
  if (loading) {
    return (
      <View style={[styles.center, { backgroundColor: c.bg }]}>
        <ActivityIndicator color={c.accent} />
      </View>
    );
  }
  return session ? <PetsScreen /> : <SignInScreen />;
}

function SignInScreen() {
  const c = usePalette();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const signIn = useCallback(async () => {
    setBusy(true);
    setError(null);
    const { error } = await supabase.auth.signInWithPassword({
      email: DEV_EMAIL,
      password: DEV_PASSWORD,
    });
    if (error) setError(error.message);
    setBusy(false);
  }, []);

  return (
    <SafeAreaView style={[styles.screen, { backgroundColor: c.bg }]}>
      <View style={styles.center}>
        <Text style={[styles.title, { color: c.text }]}>One Roof</Text>
        <Text style={[styles.muted, { color: c.muted }]}>React Native rewrite — foundation</Text>
        <Pressable
          accessibilityRole="button"
          onPress={signIn}
          disabled={busy}
          style={[styles.button, { backgroundColor: c.accent }, busy && styles.buttonDisabled]}
        >
          <Text style={styles.buttonText}>{busy ? 'Signing in…' : 'Dev sign in'}</Text>
        </Pressable>
        {error ? <Text style={styles.error}>{error}</Text> : null}
        <Text style={[styles.hint, { color: c.muted }]}>
          Temporary dev login. Google OAuth + Sign in with Apple next.
        </Text>
      </View>
    </SafeAreaView>
  );
}

function PetsScreen() {
  const c = usePalette();
  const { session } = useAuth();
  const [pets, setPets] = useState<PetRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    (async () => {
      const { data, error } = await supabase
        .from('pets')
        .select('id,name,emoji,species')
        .order('created_at');
      if (!active) return;
      if (error) setError(error.message);
      else setPets((data as PetRow[]) ?? []);
      setLoading(false);
    })();
    return () => {
      active = false;
    };
  }, []);

  return (
    <SafeAreaView style={[styles.screen, { backgroundColor: c.bg }]}>
      <View style={styles.header}>
        <View>
          <Text style={[styles.title, { color: c.text }]}>Pets</Text>
          <Text style={[styles.muted, { color: c.muted }]}>{session?.user.email ?? ''}</Text>
        </View>
        <Pressable accessibilityRole="button" onPress={() => supabase.auth.signOut()}>
          <Text style={[styles.link, { color: c.accent }]}>Sign out</Text>
        </Pressable>
      </View>

      {loading ? (
        <View style={styles.center}>
          <ActivityIndicator color={c.accent} />
        </View>
      ) : error ? (
        <Text style={styles.error}>{error}</Text>
      ) : pets.length === 0 ? (
        <Text style={[styles.muted, { color: c.muted, paddingHorizontal: 20 }]}>
          No pets in this household yet.
        </Text>
      ) : (
        <FlatList
          data={pets}
          keyExtractor={(p) => p.id}
          contentContainerStyle={styles.list}
          renderItem={({ item }) => (
            <View style={[styles.row, { backgroundColor: c.card }]}>
              <Text style={styles.rowEmoji}>{item.emoji ?? '🐾'}</Text>
              <View style={styles.rowText}>
                <Text style={[styles.rowName, { color: c.text }]}>{item.name}</Text>
                {item.species ? (
                  <Text style={[styles.muted, { color: c.muted }]}>{item.species}</Text>
                ) : null}
              </View>
            </View>
          )}
        />
      )}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1 },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: 10 },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 20,
    paddingTop: 8,
    paddingBottom: 12,
  },
  title: { fontSize: 28, fontWeight: '600' },
  muted: { fontSize: 14 },
  hint: { fontSize: 13, textAlign: 'center', paddingHorizontal: 32, marginTop: 8 },
  link: { fontSize: 16, fontWeight: '500' },
  button: {
    marginTop: 8,
    paddingHorizontal: 28,
    paddingVertical: 14,
    borderRadius: 12,
  },
  buttonDisabled: { opacity: 0.6 },
  buttonText: { color: '#ffffff', fontSize: 16, fontWeight: '600' },
  error: { color: '#c0392b', fontSize: 14, textAlign: 'center', paddingHorizontal: 24 },
  list: { paddingHorizontal: 16, gap: 10, paddingBottom: 24 },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 14,
    padding: 14,
    borderRadius: 12,
  },
  rowEmoji: { fontSize: 28 },
  rowText: { flex: 1 },
  rowName: { fontSize: 17, fontWeight: '500' },
});
