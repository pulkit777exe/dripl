'use client';

export default function GlobalError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return (
    <html>
      <body style={{
        display: 'flex', flexDirection: 'column', alignItems: 'center',
        justifyContent: 'center', height: '100vh', gap: '16px',
        fontFamily: 'system-ui, sans-serif', textAlign: 'center', padding: '2rem',
        margin: 0
      }}>
        <p style={{ fontSize: '13px', color: '#888', letterSpacing: '0.08em', textTransform: 'uppercase' }}>
          Something went wrong
        </p>
        <h1 style={{ fontSize: '24px', fontWeight: 500, margin: 0 }}>
          An unexpected error occurred
        </h1>
        <p style={{ fontSize: '14px', color: '#666', margin: 0 }}>
          {error.digest ? `Error ID: ${error.digest}` : 'Please try refreshing the page.'}
        </p>
        <button onClick={reset} style={{
          marginTop: '8px', fontSize: '14px', padding: '8px 20px',
          border: '1px solid #ddd', borderRadius: '8px', background: 'none',
          cursor: 'pointer'
        }}>
          Try again
        </button>
      </body>
    </html>
  );
}
