import { useMemo, useState } from 'react';
import {
  Bot,
  Cable,
  Clock,
  Globe,
  Plug,
  Send,
  Settings,
  ShieldCheck,
  Terminal,
  User,
  Users,
  Wrench,
} from 'lucide-react';
import type { Entry, EntryKind, Project } from '../types';
import { useI18n } from '../i18n';

interface EntryMapPanelProps {
  project: Project;
  selectedEntryId: string | null;
  onSelectEntry: (entryId: string) => void;
}

const kindLabels: Record<EntryKind, { en: string; zh: string }> = {
  http: { en: 'HTTP', zh: 'HTTP' },
  ui: { en: 'UI action', zh: '界面操作' },
  cli: { en: 'CLI', zh: 'CLI' },
  event: { en: 'Event', zh: '事件' },
  job: { en: 'Job', zh: '后台任务' },
  tool: { en: 'Tool', zh: '工具' },
  websocket: { en: 'WebSocket', zh: 'WebSocket' },
};

const kindIcons: Record<EntryKind, typeof Globe> = {
  http: Globe,
  ui: Send,
  cli: Terminal,
  event: Cable,
  job: Clock,
  tool: Wrench,
  websocket: Plug,
};

const roleIcons = {
  'End user': User,
  '普通用户': User,
  Admin: Settings,
  '管理员': Settings,
  Developer: Terminal,
  '开发者': Terminal,
  System: Clock,
  '系统': Clock,
  'External service': ShieldCheck,
  '外部服务': ShieldCheck,
};

export function EntryMapPanel({ project, selectedEntryId, onSelectEntry }: EntryMapPanelProps) {
  const { t, language } = useI18n();
  const [roleFilter, setRoleFilter] = useState<string | null>(null);
  const [kindFilter, setKindFilter] = useState<EntryKind | null>(null);

  const roles = useMemo(
    () => Array.from(new Set(project.entries.map((entry) => entry.role))),
    [project.entries],
  );
  const kinds = useMemo(
    () => Array.from(new Set(project.entries.map((entry) => entry.kind))),
    [project.entries],
  );

  const groupedEntries = useMemo(() => {
    return roles
      .filter((role) => !roleFilter || role === roleFilter)
      .map((role) => ({
        role,
        entries: project.entries.filter(
          (entry) => entry.role === role && (!kindFilter || entry.kind === kindFilter),
        ),
      }))
      .filter((group) => group.entries.length > 0);
  }, [project.entries, roles, roleFilter, kindFilter]);

  return (
    <div>
      <div className="section-header">
        <div>
          <h1 className="section-title">{t('entryMap')}</h1>
          <p className="section-subtitle">
            {t('startFromEntry')}
          </p>
        </div>
      </div>

      <section className="panel-section">
        <h2 className="panel-heading">
          <Users size={15} />
          {t('roleFilters')}
        </h2>
        <div className="filter-bar">
          {roles.map((role) => (
            <button
              type="button"
              className="filter-button"
              key={role}
              aria-pressed={roleFilter === role}
              onClick={() => setRoleFilter(roleFilter === role ? null : role)}
            >
              {role}
            </button>
          ))}
        </div>
      </section>

      <section className="panel-section">
        <h2 className="panel-heading">
          <Bot size={15} />
          {t('entryTypes')}
        </h2>
        <div className="filter-bar">
          {kinds.map((kind) => {
            const Icon = kindIcons[kind];
            return (
              <button
                type="button"
                className="filter-button"
                key={kind}
                aria-pressed={kindFilter === kind}
                onClick={() => setKindFilter(kindFilter === kind ? null : kind)}
              >
                <Icon size={13} />
                {kindLabels[kind][language]}
              </button>
            );
          })}
        </div>
      </section>

      {groupedEntries.map(({ role, entries }) => {
        const RoleIcon = roleIcons[role];
        return (
          <section className="role-group" key={role}>
            <h2 className="role-heading">
              <RoleIcon size={16} />
              {role}
            </h2>
            <div className="entry-list">
              {entries.map((entry: Entry) => {
                const Icon = kindIcons[entry.kind];
                return (
                  <button
                    type="button"
                    className="entry-button"
                    key={entry.id}
                    aria-pressed={selectedEntryId === entry.id}
                    onClick={() => onSelectEntry(entry.id)}
                  >
                    <span className="entry-top">
                      <span className="entry-name">
                        <Icon size={14} /> {entry.name}
                      </span>
                      <span className="entry-kind">{kindLabels[entry.kind][language]}</span>
                    </span>
                    <span className="entry-detail">{t('input')}: {entry.input}</span>
                    <span className="entry-detail">{t('auth')}: {entry.auth}</span>
                    <span className="entry-permissions">
                      {entry.permissions.map((permission) => (
                        <span className="permission-tag" key={permission}>
                          {permission}
                        </span>
                      ))}
                    </span>
                  </button>
                );
              })}
            </div>
          </section>
        );
      })}
    </div>
  );
}
