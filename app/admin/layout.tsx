import { redirect } from 'next/navigation';
import { getValidatedAppSession } from '@/lib/auth-server';
import AdminLayoutClient from './AdminLayoutClient';

export default async function AdminLayout({ children }: { children: React.ReactNode }) {
  const t0 = performance.now();
  const session = await getValidatedAppSession();
  if (!session.isLoggedIn || session.role !== 'ADMIN') {
    redirect('/login');
  }
  if (process.env.NODE_ENV === 'development') {
    console.log(`[DEV TIMING] AdminLayout render: ${(performance.now() - t0).toFixed(1)}ms`);
  }
  return <AdminLayoutClient username={session.username}>{children}</AdminLayoutClient>;
}
