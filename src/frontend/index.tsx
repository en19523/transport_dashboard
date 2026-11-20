import React, { useState } from 'react';
import ForgeReconciler, {
  Button,
  CheckboxGroup,
  Inline,
  Label,
  SectionMessage,
  Stack,
  Text,
  Textfield,
  useConfig,
} from '@forge/react';
import { invoke, router } from '@forge/bridge';
import { DEFAULT_CONFIG, ReportConfig } from '../types';

const App = () => {
  const stored = (useConfig() ?? {}) as Partial<ReportConfig>;
  const config: ReportConfig = {
    project: stored.project || DEFAULT_CONFIG.project,
    okStatuses: stored.okStatuses || DEFAULT_CONFIG.okStatuses,
    depPhrases: stored.depPhrases || DEFAULT_CONFIG.depPhrases,
    assignees: stored.assignees ?? '',
    onlyBlockers: stored.onlyBlockers ?? [],
  };

  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const create = async () => {
    setBusy(true);
    setError(null);
    try {
      await invoke('createReport', config as unknown as Record<string, unknown>);
      await router.reload(); // Reload the page so the new report becomes visible
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      setBusy(false);
    }
  };

  return (
    <Stack space="space.100">
      <Inline space="space.150" alignBlock="center">
        <Button appearance="primary" onClick={() => void create()} isDisabled={busy}>
          {busy ? "Erstelle Bericht..." : "Bericht erstellen"}
        </Button>
        <Text>
          Projekt {config.project}
          {config.assignees ? ` | Bearbeiter: ${config.assignees}` : ''} – der Bericht wird direkt unter diesem Button in die Seite geschrieben.
        </Text>
      </Inline>
      {error && (
        <SectionMessage appearance="error" title="Bericht konnte nicht erstellt werden">
          <Text>{error}</Text>
        </SectionMessage>
      )}
    </Stack>
  );
};

/** Macro configuration (click the macro > Edit). Fields are stored via their `name`. */
const Config = () => {
  const c = (useConfig() ?? {}) as Partial<ReportConfig>;
  return (
    <>
      <Label labelFor="project">Projekt-Key</Label>
      <Textfield id="project" name="project" defaultValue={c.project || DEFAULT_CONFIG.project} />
      <Label labelFor="okStatuses">Status gilt als "erledigt genug" (Komma-getrennt)</Label>
      <Textfield id="okStatuses" name="okStatuses" defaultValue={c.okStatuses || DEFAULT_CONFIG.okStatuses} />
      <Label labelFor="depPhrases">Abhaengigkeits-Formulierungen (Komma-getrennt)</Label>
      <Textfield id="depPhrases" name="depPhrases" defaultValue={c.depPhrases || DEFAULT_CONFIG.depPhrases} />
      <Label labelFor="assignees">Nur diese Bearbeiter (Komma-getrennt, Name oder E-Mail, leer = alle)</Label>
      <Textfield id="assignees" name="assignees" defaultValue={c.assignees ?? ''} />
      <CheckboxGroup
        name="onlyBlockers"
        label="Filter"
        items={[{ label: 'Nur Tickets mit Blockern anzeigen', value: 'yes' }]}
        defaultValue={c.onlyBlockers ?? []}
      />
    </>
  );
};

ForgeReconciler.render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);
ForgeReconciler.addConfig(<Config />);
