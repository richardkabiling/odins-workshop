import type { ReactNode } from 'react';
import type { Solution, StatueTemplate, ConversionSet, StatKey, Failure } from '../domain/types';
import { featherById } from '../data/feathers.generated';
import { getAttackBonus, getDefenseBonus } from '../data/setBonuses.generated';
import { computeStatueStats, computeRawStats, PCT_CATEGORY_MAP } from '../domain/scoring';
import { STAT_LABELS, ATTACK_STATS, DEFENSE_STATS, PVE_STATS, PVP_STATS } from '../data/statCategories';
import type { StatRanking } from '../domain/ranking';
import { featherImages } from './featherImages';
import { RarityDot, TypeChip } from './FeatherBadges';
import { FeatherTooltipContent, WithTooltip } from './FeatherTooltip';

function toRoman(n: number): string {
  const table: [number, string][] = [
    [20,'XX'],[19,'XIX'],[18,'XVIII'],[17,'XVII'],[16,'XVI'],
    [15,'XV'],[14,'XIV'],[13,'XIII'],[12,'XII'],[11,'XI'],
    [10,'X'],[9,'IX'],[8,'VIII'],[7,'VII'],[6,'VI'],
    [5,'V'],[4,'IV'],[3,'III'],[2,'II'],[1,'I'],
  ];
  for (const [v, s] of table) if (n >= v) return s;
  return String(n);
}

function featherDisplayName(id: string): string {
  return id === 'Stats' ? 'Valor/Faith/Glory' : id;
}

const PCT_LABELS: Record<string, string> = {
  attack: 'Attack %',
  defense: 'Defense %',
  pve: 'PvE %',
  pvp: 'PvP %',
};

const ALL_STAT_KEYS: StatKey[] = [
  ...ATTACK_STATS, ...DEFENSE_STATS, ...PVE_STATS, ...PVP_STATS, 'INTDEXSTR', 'VIT',
];

interface Props {
  solution: Solution | null;
  failure: Failure | null;
  ranking: StatRanking;
}

export function ResultsView({ solution, failure }: Props) {
  if (failure) {
    if (failure.kind === 'generic') {
      return (
        <div className="card" style={{ borderColor: 'var(--danger)', color: 'var(--danger)' }}>
          {failure.message}
        </div>
      );
    }
    // inventory failure
    return (
      <div className="card" style={{ borderColor: 'var(--danger)', color: 'var(--danger)' }}>
        <div style={{ fontWeight: 600, marginBottom: 8 }}>
          Insufficient feathers to build 10 statues:
        </div>
        {failure.diagnostics.map((d) => (
          <div key={`${d.kind}-${d.rarity}`} style={{ marginBottom: 6 }}>
            <div>
              • {d.kind.charAt(0).toUpperCase() + d.kind.slice(1)} statues need {d.need} distinct {d.rarity.toLowerCase()} feather{d.need !== 1 ? 's' : ''}; you have {d.have}.
            </div>
            {d.missing.length > 0 && (
              <div style={{ paddingLeft: 14, fontSize: 12, color: 'var(--danger)', opacity: 0.85 }}>
                Missing: {d.missing.join(', ')}
              </div>
            )}
          </div>
        ))}
      </div>
    );
  }
  if (!solution) return null;

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
            <StatueCard key={i} index={i + 1} template={t} kind="attack" />
          ))}
        </div>
      </section>

      <section>
        <h2 style={{ marginBottom: 10 }}>Defense Statues</h2>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(5, 1fr)', gap: 10 }}>
          {solution.defense.map((t, i) => (
            <StatueCard key={i} index={i + 1} template={t} kind="defense" />
          ))}
        </div>
      </section>

      <TotalStatsSummary solution={solution} />
      <BudgetSummary spentPerSet={solution.spentPerSet} totalPerSet={solution.totalPerSet} />
    </div>
  );
}

function StatueCard({
  index, template, kind,
}: {
  index: number;
  template: StatueTemplate;
  kind: 'attack' | 'defense';
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

  // Canonical key order: all stat keys that appear in boosted, sorted by boosted value descending.
  // Sections 2 and 4 use the same order, filtered to keys present in each.
  const canonicalOrder = ALL_STAT_KEYS
    .filter(k => (boosted[k] ?? 0) !== 0)
    .sort((a, b) => (boosted[b] ?? 0) - (boosted[a] ?? 0));

  const rawStatKeys = canonicalOrder.filter(k => (raw[k] ?? 0) !== 0);

  // Intermediate: raw × (1 + pct%) — only relevant when pct bonuses exist
  const withPct: Partial<Record<StatKey, number>> = {};
  if (pctRows.length > 0) {
    for (const key of rawStatKeys) {
      const cat = PCT_CATEGORY_MAP[key];
      const pct = cat ? (bonus.pct[cat] ?? 0) : 0;
      withPct[key] = (raw[key] ?? 0) * (1 + pct / 100);
    }
  }
  const withPctKeys = canonicalOrder.filter(k => (withPct[k] ?? 0) !== 0);
  const boostedKeys = canonicalOrder;

  function fmtVal(v: number) { return Number.isInteger(v) ? v : v.toFixed(1); }

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
      <div style={{ display: 'flex', flexDirection: 'column', gap: 8, marginBottom: 8 }}>
        {template.feathers.map(({ feather, tier }) => (
          <FeatherRow key={feather} feather={feather} tier={tier} />
        ))}
      </div>

      {/* Section 2: Total Feather Stats */}
      <Divider />
      <SectionLabel>Total Feather Stats</SectionLabel>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 2, marginBottom: 8 }}>
        {rawStatKeys.map(k => (
          <div key={k} style={{ display: 'flex', justifyContent: 'space-between' }}>
            <span style={{ color: 'var(--muted)' }}>{STAT_LABELS[k]}</span>
            <span style={{ fontWeight: 600 }}>{fmtVal(raw[k]!)}</span>
          </div>
        ))}
      </div>

      {/* Section 3: Set Bonuses */}
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

      {/* Section 4: Total Stats with % Set Bonuses (only when pct bonuses exist) */}
      {withPctKeys.length > 0 && (
        <>
          <Divider />
          <SectionLabel>Total Stats with % Set Bonuses</SectionLabel>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 2, marginBottom: 8 }}>
            {withPctKeys.map(k => (
              <div key={k} style={{ display: 'flex', justifyContent: 'space-between' }}>
                <span style={{ color: 'var(--muted)' }}>{STAT_LABELS[k]}</span>
                <span style={{ fontWeight: 600 }}>{Math.floor(withPct[k]!)}</span>
              </div>
            ))}
          </div>
        </>
      )}

      {/* Section 5: Total Stats with All Set Bonuses */}
      <Divider />
      <SectionLabel>Total Stats with All Set Bonuses</SectionLabel>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
        {boostedKeys.map(k => (
          <div key={k} style={{ display: 'flex', justifyContent: 'space-between' }}>
            <span style={{ color: 'var(--muted)' }}>{STAT_LABELS[k]}</span>
            <span style={{ fontWeight: 600 }}>{Math.floor(boosted[k]!)}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

function FeatherRow({ feather, tier }: { feather: string; tier: number }) {
  const def = featherById.get(feather)!;

  return (
    <WithTooltip tooltip={<FeatherTooltipContent feather={feather} tier={tier} />}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
        {/* Image with tier overlay */}
        <div style={{ position: 'relative', flexShrink: 0, width: 64, height: 64 }}>
          {featherImages[feather]
            ? <img src={featherImages[feather]} alt={feather} style={{ width: 64, height: 64, objectFit: 'contain' }} />
            : <div style={{ width: 64, height: 64, background: 'var(--surface2)', borderRadius: 6 }} />
          }
          <div style={{
            position: 'absolute', top: 2, left: 2,
            background: 'rgba(255,255,255,0.25)',
            borderRadius: 3,
            padding: '1px 4px',
            fontSize: 10,
            fontWeight: 700,
            color: '#4a9eff',
            lineHeight: 1.4,
            backdropFilter: 'blur(2px)',
          }}>
            {toRoman(tier)}
          </div>
        </div>

        {/* Name / badges / cost */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 5 }}>
            <RarityDot rarity={def.rarity} />
            <span style={{ fontWeight: 600 }}>{featherDisplayName(feather)}</span>
          </div>
          <div style={{ display: 'flex', gap: 4, alignItems: 'center' }}>
            <TypeChip type={def.type} />
          </div>
          <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
            <span style={{ background: 'var(--surface2)', borderRadius: 3, padding: '0 5px', fontSize: 11 }}>T{tier}</span>
            <span style={{ color: 'var(--muted)', fontSize: 10 }}>{def.tiers[tier]?.totalCost ?? 0} T1</span>
          </div>
        </div>
      </div>
    </WithTooltip>
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

function BudgetSummary({ spentPerSet, totalPerSet }: { spentPerSet: Partial<Record<ConversionSet, number>>; totalPerSet: Partial<Record<ConversionSet, number>> }) {
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
            <span style={{ color: 'var(--muted)', fontSize: 12 }}> / {totalPerSet[setId] ?? '?'} T1 feathers</span>
          </div>
        ))}
      </div>
    </div>
  );
}
