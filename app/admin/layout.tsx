import { redirect } from 'next/navigation';
import { getAppSession } from '@/lib/auth';
import AdminLayoutClient from './AdminLayoutClient';

export default async function AdminLayout({ children }: { children: React.ReactNode }) {
  const t0 = performance.now();
  const session = await getAppSession();
  if (!session.isLoggedIn || session.role !== 'ADMIN') {
    redirect('/api/auth/logout');
  }
  if (process.env.NODE_ENV === 'development') {
    console.log(`[DEV TIMING] AdminLayout render: ${(performance.now() - t0).toFixed(1)}ms`);
  }
  return <AdminLayoutClient>{children}</AdminLayoutClient>;
}
