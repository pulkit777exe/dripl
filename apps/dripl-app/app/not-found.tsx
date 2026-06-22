'use client';
import Link from 'next/link';

export default function NotFound() {
  return (
    <div style={{
      display: 'flex', flexDirection: 'column', alignItems: 'center',
      justifyContent: 'center', height: '100vh', gap: '16px',
      fontFamily: 'inherit', textAlign: 'center', padding: '2rem'
    }}>
      <p style={{ fontSize: '13px', color: '#888', letterSpacing: '0.08em', textTransform: 'uppercase' }}>
        404
      </p>
      <h1 style={{ fontSize: '24px', fontWeight: 500, margin: 0 }}>
        This file doesn&apos;t exist
      </h1>
      <p style={{ fontSize: '15px', color: '#666', margin: 0 }}>
        It may have been deleted or you may not have access.
      </p>
      <Link href="/dashboard" style={{
        marginTop: '8px', fontSize: '14px', padding: '8px 20px',
        border: '1px solid #ddd', borderRadius: '8px', textDecoration: 'none',
        color: 'inherit'
      }}>
        Back to your files
      </Link>
    </div>
  );
}
