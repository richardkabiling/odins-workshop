import type { ReactNode } from 'react';
import type { Solution, StatueTemplate, ConversionSet, StatKey } from '../domain/types';
import { featherById } from '../data/feathers.generated';
import { getAttackBonus, getDefenseBonus } from '../data/setBonuses.generated';
import { computeStatueStats, computeRawStats } from '../domain/scoring';
import { STAT_LABELS, ATTACK_STATS, DEFENSE_STATS, PVE_STATS, PVP_STATS } from '../data/statCategories';
import { PRESETS } from '../domain/presets';
import type { Preset } from '../domain/presets';
import { featherImages } from './featherImages';

const PCT_LABELS: Record<string, string> = {
  attack: 'Attack %',
  defense: 'Defense %',
  pve: 'PvE %',
  pvp: 'PvP %',
};

const TYPE_CLASS: Record<string, string> = {
  Attack: 'atk',
  Defense: 'def',
  Hybrid: 'hybrid',
};

const ALL_STAT_KEYS: StatKey[] = [
  ...ATTACK_STATS, ...DEFENSE_STATS, ...PVE_STATS, ...PVP_STATS, 'INTDEXSTR', 'VIT',
];

interface Props {
  solution: Solution | null;
  error: string | null;
  atkPct: number;
  pvp: boolean;
}

export function ResultsView({ solution, error, atkPct, pvp }: Props) {
  if (error) {
    return (
      <div className="card" style={{ borderColor: 'var(--danger)', color: 'var(--danger)' }}>
        {error}
      </div>
    );
  }
  if (!solution) return null;

  const atkPreset = pvp ? PRESETS.PvP_Atk : PRESETS.PvE_Atk;
  const defPreset = pvp ? PRESETS.PvP_Def : PRESETS.PvE_Def;

  void atkPct; // passed in but preset selection is done via pvp flag

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 16 }}>
        <h2>Results</h2>
        <div style={{ background: 'var(--accent)', borderRadius: 4, padding: '4px 14px', fontWeight: 700, fontSize: 18, color: '#fff' }}>
          Primary Score: {solution.score.toFixed(1)}
        </div>
      </div>

      <section>
        <h2 style={{ marginBottom: 10 }}>Attack Statues</h2>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(5, 1fr)', gap: 10 }}>
          {solution.attack.map((t, i) => (
            <StatueCard key={i} index={i + 1} template={t} kind="attack" preset={atkPreset} />
          ))}
        </div>
      </section>

      <section>
        <h2 style={{ marginBottom: 10 }}>Defense Statues</h2>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(5, 1fr)', gap: 10 }}>
          {solution.defense.map((t, i) => (
            <StatueCard key={i} index={i + 1} template={t} kind="defense" preset={defPreset} />
          ))}
        </div>
      </section>

      <TotalStatsSummary solution={solution} />
      <BudgetSummary spentPerSet={solution.spentPerSet} />
    </div>
  );
}

function StatueCard({
  index, template, kind, preset,
}: {
  index: number;
  template: StatueTemplate;
  kind: 'attack' | 'defense';
  preset: Preset;
}) {
  if (!template.feathers.length) {
    return (
      <div className="card" style={{ opacity: 0.5 }}>
        <h3 style={{ marginBottom: 6, fontSize: 13 }}>#{index}</h3>
        <span style={{ color: 'var(--muted)', fontSize: 12 }}>Empty (no budget)</span>
      </div>
    );
  }

  const bonus = kind === 'attack' ? getAttackBonus(template.minTier) : getDefenseBonus(template.minTier);
  const raw = computeRawStats(template);
  const boosted = computeStatueStats(template, bonus);

  const flatRows = (Object.entries(bonus.flat) as [StatKey, number][]).filter(([, v]) => v !== 0);
  const pctRows = (Object.entries(bonus.pct) as [string, number][]).filter(([, v]) => v !== 0);

  const statRows = ALL_STAT_KEYS
    .filter(k => (boosted[k] ?? 0) !== 0 || (raw[k] ?? 0) !== 0)
    .sort((a, b) => (preset.statWeights[b] ?? 0) - (preset.statWeights[a] ?? 0))
    .map(k => ({ key: k, rawVal: raw[k] ?? 0, boostedVal: boosted[k] ?? 0 }));

  return (
    <div className="card" style={{ display: 'flex', flexDirection: 'column', gap: 0, fontSize: 12 }}>
      {/* Header */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', marginBottom: 8 }}>
        <h3>#{index}</h3>
        <span style={{ background: 'var(--surface2)', borderRadius: 4, padding: '1px 6px', fontSize: 11 }}>
          T{template.minTier} set
        </span>
      </div>

      {/* Section 1: Feathers */}
      <SectionLabel>Feathers</SectionLabel>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 6, marginBottom: 8 }}>
        {template.feathers.map(({ feather, tier }) => {
          const def = featherById.get(feather)!;
          return (
            <div key={feather} style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              {featherImages[feather]
                ? <img src={featherImages[feather]} alt={feather} style={{ width: 48, height: 48, objectFit: 'contain', flexShrink: 0 }} />
                : <div style={{ width: 48, height: 48, background: 'var(--surface2)', borderRadius: 6, flexShrink: 0 }} />
              }
              <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
                <span style={{ fontWeight: 600 }}>{feather}</span>
                <div style={{ display: 'flex', gap: 4 }}>
                  <span className={`badge ${def.rarity.toLowerCase()}`} style={{ fontSize: 9, padding: '1px 4px' }}>{def.rarity}</span>
                  <span className={`badge ${TYPE_CLASS[def.type]}`} style={{ fontSize: 9, padding: '1px 4px' }}>{def.type}</span>
                </div>
                <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
                  <span style={{ background: 'var(--surface2)', borderRadius: 3, padding: '0 5px', fontSize: 11 }}>T{tier}</span>
                  <span style={{ color: 'var(--muted)', fontSize: 10 }}>{def.tiers[tier]?.totalCost ?? 0} T1</span>
                </div>
              </div>
            </div>
          );
        })}
      </div>

      {/* Section 2: Set Bonuses */}
      <Divider />
      <SectionLabel>Set Bonuses (T{template.minTier})</SectionLabel>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 2, marginBottom: 8 }}>
        {flatRows.map(([k, v]) => (
          <div key={k} style={{ display: 'flex', justifyContent: 'space-between' }}>
            <span style={{ color: 'var(--muted)' }}>{STAT_LABELS[k]} flat</span>
            <span style={{ color: 'var(--green)', fontWeight: 600 }}>+{v}</span>
          </div>
        ))}
        {pctRows.map(([k, v]) => (
          <div key={k} style={{ display: 'flex', justifyContent: 'space-between' }}>
            <span style={{ color: 'var(--muted)' }}>{PCT_LABELS[k] ?? k}</span>
            <span style={{ color: 'var(--green)', fontWeight: 600 }}>+{v}%</span>
          </div>
        ))}
        {flatRows.length === 0 && pctRows.length === 0 && (
          <span style={{ color: 'var(--muted)', fontSize: 11 }}>No bonuses at T{template.minTier}</span>
        )}
      </div>

      {/* Section 3: Total Stats */}
      <Divider />
      <SectionLabel>Total Stats</SectionLabel>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
        {statRows.map(({ key, rawVal, boostedVal }) => (
          <div key={key} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <span style={{ color: 'var(--muted)' }}>{STAT_LABELS[key]}</span>
            <span style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
              <span style={{ color: 'var(--muted)', fontSize: 10 }}>
                {Number.isInteger(rawVal) ? rawVal : rawVal.toFixed(1)}
              </span>
              <span style={{ color: 'var(--muted)', fontSize: 10 }}>→</span>
              <span style={{ fontWeight: 600 }}>
                {Number.isInteger(boostedVal) ? boostedVal : boostedVal.toFixed(1)}
              </span>
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}

function SectionLabel({ children }: { children: ReactNode }) {
  return (
    <div style={{ fontSize: 10, fontWeight: 700, letterSpacing: '.06em', textTransform: 'uppercase', color: 'var(--muted)', marginBottom: 4 }}>
      {children}
    </div>
  );
}

function Divider() {
  return <hr style={{ border: 'none', borderTop: '1px solid var(--border)', margin: '6px 0' }} />;
}

function TotalStatsSummary({ solution }: { solution: Solution }) {
  const totals: Partial<Record<StatKey, number>> = {};

  for (const template of solution.attack) {
    if (!template.feathers.length) continue;
    const bonus = getAttackBonus(template.minTier);
    for (const [k, v] of Object.entries(computeStatueStats(template, bonus)) as [StatKey, number][]) {
      totals[k] = (totals[k] ?? 0) + v;
    }
  }
  for (const template of solution.defense) {
    if (!template.feathers.length) continue;
    const bonus = getDefenseBonus(template.minTier);
    for (const [k, v] of Object.entries(computeStatueStats(template, bonus)) as [StatKey, number][]) {
      totals[k] = (totals[k] ?? 0) + v;
    }
  }

  const rows = ALL_STAT_KEYS
    .filter(k => (totals[k] ?? 0) !== 0)
    .map(k => ({ key: k, val: totals[k]! }));

  if (rows.length === 0) return null;

  return (
    <div className="card">
      <h3 style={{ marginBottom: 10 }}>Total Stats — All Statues</h3>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: '4px 24px' }}>
        {rows.map(({ key, val }) => (
          <div key={key} style={{ display: 'flex', justifyContent: 'space-between', fontSize: 13 }}>
            <span style={{ color: 'var(--muted)' }}>{STAT_LABELS[key]}</span>
            <span style={{ fontWeight: 600 }}>{Number.isInteger(val) ? val : val.toFixed(1)}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

function BudgetSummary({ spentPerSet }: { spentPerSet: Partial<Record<ConversionSet, number>> }) {
  const sets = (Object.entries(spentPerSet) as [ConversionSet, number][]).filter(([, v]) => v > 0);
  if (sets.length === 0) return null;
  return (
    <div className="card">
      <h3 style={{ marginBottom: 8 }}>Total Budget Used</h3>
      <div style={{ display: 'flex', gap: 20, flexWrap: 'wrap' }}>
        {sets.map(([setId, spent]) => (
          <div key={setId}>
            <span style={{ color: 'var(--muted)', fontSize: 12 }}>{setId}: </span>
            <span style={{ fontWeight: 600 }}>{spent}</span>
            <span style={{ color: 'var(--muted)', fontSize: 12 }}> T1 feathers</span>
          </div>
        ))}
      </div>
    </div>
  );
}
