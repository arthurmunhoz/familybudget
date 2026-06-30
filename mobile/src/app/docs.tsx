import VaultGate from '@/apps/docs/VaultGate';
import DocumentVault from '@/apps/docs/DocumentVault';

export default function DocumentsScreen() {
  return (
    <VaultGate>
      <DocumentVault />
    </VaultGate>
  );
}
