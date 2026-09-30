import type { Metadata } from 'next';
import './globals.css';
import './auth.css';
import './clean.css';
import './notifications.css';

export const metadata: Metadata = { title: 'Offline POS Desktop', description: 'Local point of sale dashboard' };
export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) { return <html lang="en"><body>{children}</body></html>; }
