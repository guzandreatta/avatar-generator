import './globals.css';
import type { Metadata } from 'next';

export const metadata: Metadata = {
  title: 'Avatar Generator',
  description: 'Generador de avatars con estilo consistente',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="es">
      <body>
        <div className="container py-10">{children}</div>
      </body>
    </html>
  );
}
