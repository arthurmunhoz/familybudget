import BrandSplash from '@/components/BrandSplash';
import Hub from '@/components/Hub';
import Login from '@/components/Login';
import Onboarding from '@/components/Onboarding';
import { useAuth } from '@/lib/auth';

export default function Index() {
  const { session, loading, profileLoaded, profile } = useAuth();
  // While the session resolves, show the branded launch screen (matches Login)
  // instead of a bare spinner, so opening the app feels warm and on-brand.
  if (loading) return <BrandSplash />;
  if (!session) return <Login />;
  // Signed in, but the profile lookup hasn't resolved yet.
  if (!profileLoaded) return <BrandSplash />;
  // Signed in with no household → onboarding (create or join). Otherwise the Hub.
  return profile ? <Hub /> : <Onboarding />;
}
