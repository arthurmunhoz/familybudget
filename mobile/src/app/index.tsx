import BrandSplash from '@/components/BrandSplash';
import Hub from '@/components/Hub';
import Login from '@/components/Login';
import { useAuth } from '@/lib/auth';

export default function Index() {
  const { session, loading } = useAuth();
  // While the session resolves, show the branded launch screen (matches Login)
  // instead of a bare spinner, so opening the app feels warm and on-brand.
  if (loading) return <BrandSplash />;
  return session ? <Hub /> : <Login />;
}
