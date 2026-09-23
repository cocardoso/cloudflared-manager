import { Badge, Button, LayerCard, Select, Text } from '@cloudflare/kumo';
import { BroomIcon, PauseIcon, PlayIcon } from '@phosphor-icons/react';
import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { levelMatches, useLogStream, type LevelFilter } from './log-stream';

const COLOR = { debug: 'text-kumo-subtle', info: 'text-kumo-default', warn: 'text-kumo-warning', error: 'text-kumo-danger', fatal: 'text-kumo-danger' };

export function LogsTab({ tunnelId }: { tunnelId: string }) {
  const { t } = useTranslation();
  const [paused, setPaused] = useState(false);
  const [level, setLevel] = useState<LevelFilter>('all');
  const { lines, connected, clear } = useLogStream(tunnelId, { paused });
  const box = useRef<HTMLDivElement>(null);
  const visible = lines.filter((l) => levelMatches(l, level));

  useEffect(() => {
    if (!paused && box.current) box.current.scrollTop = box.current.scrollHeight;
  }, [visible.length, paused]);

  return (
    <LayerCard>
      <LayerCard.Secondary>
        <div className="flex flex-wrap items-center justify-between gap-2">
          <Badge variant={paused ? 'neutral' : connected ? 'success' : 'warning'} appearance="dot">
            {paused ? t('tunnel.logsPaused') : connected ? t('tunnel.live') : t('tunnel.disconnected')}
          </Badge>
          <div className="flex flex-wrap items-center gap-2">
            <Select
              label={t('tunnel.level')}
              value={level}
              onValueChange={(v) => setLevel(v as LevelFilter)}
              items={{ all: t('tunnel.allLevels'), info: 'info+', warn: 'warn+', error: 'error+' }}
            />
            <Button size="sm" icon={paused ? <PlayIcon /> : <PauseIcon />} onClick={() => setPaused((p) => !p)}>
              {paused ? t('tunnel.resume') : t('tunnel.pause')}
            </Button>
            <Button size="sm" variant="ghost" icon={<BroomIcon />} onClick={clear}>{t('tunnel.clear')}</Button>
          </div>
        </div>
      </LayerCard.Secondary>
      <LayerCard.Primary className="p-0">
        <div ref={box} className="h-[28rem] overflow-y-auto rounded-b-lg bg-kumo-recessed p-3 font-mono text-xs leading-relaxed">
          {visible.length === 0 ? (
            <Text variant="secondary">{t('tunnel.noLogs')}</Text>
          ) : (
            visible.map((l, i) => (
              <div key={`${l.time}-${i}`} className={`break-all whitespace-pre-wrap ${COLOR[l.level]}`}>{l.message}</div>
            ))
          )}
        </div>
      </LayerCard.Primary>
    </LayerCard>
  );
}
