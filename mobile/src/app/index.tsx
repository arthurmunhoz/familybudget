import Hub from '@/components/Hub';
import Login from '@/components/Login';
import { Loader } from '@/components/ui';
import { useAuth } from '@/lib/auth';

export default function Index() {
  const { session, loading } = useAuth();
  if (loading) return <Loader />;
  return session ? <Hub /> : <Login />;
}
