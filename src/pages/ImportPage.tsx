import { useLocation } from 'react-router-dom';
import { AiImportPage } from '../components/AiImportPage';
import { PageFrame } from '../layouts/PageFrame';
import { ButtonLink } from '../ui';
import { safeOrbitLink } from '../utils/orbit-links';

export function ImportPage() {
  const location = useLocation();
  const candidate = (location.state as { importReturnTo?: string } | null)?.importReturnTo;
  const returnTo = candidate && safeOrbitLink(candidate, window.location.origin);
  return <PageFrame><div className="import-page-back"><ButtonLink variant="quiet" to={returnTo && !returnTo.startsWith('/import') ? returnTo : '/assistant'}>返回</ButtonLink></div><AiImportPage /></PageFrame>;
}
