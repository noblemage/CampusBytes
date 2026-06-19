export const rpName = 'CampusByte Authenticator';

export const getRpID = (req: Request) => {
  const host = req.headers.get('x-forwarded-host') || req.headers.get('host') || 'localhost';
  return host.split(':')[0];
};

export const getOrigin = (req: Request) => {
  const host = req.headers.get('x-forwarded-host') || req.headers.get('host') || 'localhost:3000';
  const protocol = req.headers.get('x-forwarded-proto') || (host.includes('localhost') ? 'http' : 'https');
  return `${protocol}://${host}`;
};
