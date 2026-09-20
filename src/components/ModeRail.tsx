import React from 'react';
import { Bolt, Box, FileText, Grid2x2, Layers3, LayoutGrid } from 'lucide-react';

/**
 * Where the user is, kept out of the toolbar.
 *
 * These six used to sit at the right end of the tool row, looking like
 * neighbours of «Яркость» — and on a 1280px laptop the row ran off the edge,
 * so «Сброс» had to be scrolled to. They are navigation, not tools, and a
 * column of their own says so.
 *
 * The panels stay independent toggles, exactly as before: planning an implant
 * against the panorama needs both open at once. «Срезы» is the way back —
 * active when nothing else is, and closing everything when pressed.
 */
interface ModeRailProps {
  panoramaOpen: boolean;
  onTogglePanorama: () => void;
  volumeOpen: boolean;
  onVolume: () => void;
  chartOpen: boolean;
  onToggleChart: () => void;
  planOpen: boolean;
  onPlan: () => void;
  onReport: () => void;
  /** Closes every panel and leaves the slices alone. */
  onSlicesOnly: () => void;
  /** On a tablet 88px of width is too dear — icons carry it alone. */
  compact: boolean;
}

interface Item {
  id: string;
  icon: React.ReactNode;
  label: string;
  title: string;
  active: boolean;
  onClick: () => void;
}

export const ModeRail: React.FC<ModeRailProps> = ({
  panoramaOpen,
  onTogglePanorama,
  volumeOpen,
  onVolume,
  chartOpen,
  onToggleChart,
  planOpen,
  onPlan,
  onReport,
  onSlicesOnly,
  compact,
}) => {
  const nothingOpen = !panoramaOpen && !volumeOpen && !chartOpen && !planOpen;

  // The split that used to be carried by colour — amber for what changes the
  // view, sky for what produces a document — is carried by the grouping now.
  const viewing: Item[] = [
    {
      id: 'slices',
      icon: <LayoutGrid className="w-4 h-4" />,
      label: 'Срезы',
      title: 'Только срезы: закрывает открытые панели',
      active: nothingOpen,
      onClick: onSlicesOnly,
    },
    {
      id: 'panorama',
      icon: <Layers3 className="w-4 h-4" />,
      label: 'Панорама',
      title: 'Развернуть объём вдоль зубной дуги (P)',
      active: panoramaOpen,
      onClick: onTogglePanorama,
    },
    {
      id: 'volume',
      icon: <Box className="w-4 h-4" />,
      label: 'Объём',
      title: 'Объём: обрезка, снимок, экспорт STL (V)',
      active: volumeOpen,
      onClick: onVolume,
    },
  ];

  const working: Item[] = [
    {
      id: 'chart',
      icon: <Grid2x2 className="w-4 h-4" />,
      label: 'Формула',
      title: 'Зубная формула: состояние каждого зуба и переход к его срезам (C)',
      active: chartOpen,
      onClick: onToggleChart,
    },
    {
      id: 'plan',
      icon: <Bolt className="w-4 h-4" />,
      label: 'План',
      title: 'Планирование имплантации и ход нижнечелюстного канала (I)',
      active: planOpen,
      onClick: onPlan,
    },
    {
      id: 'report',
      icon: <FileText className="w-4 h-4" />,
      label: 'Заключение',
      title: 'Собрать заключение: формула, панорама, срезы по зубам, текст и подпись (D)',
      active: false,
      onClick: onReport,
    },
  ];

  const button = (item: Item) => (
    <button
      key={item.id}
      onClick={item.onClick}
      title={item.title}
      aria-pressed={item.active}
      className={`flex flex-col items-center justify-center gap-1 rounded transition-colors ${
        compact ? 'py-2' : 'py-2 px-1'
      } ${
        item.active
          ? 'bg-blue-600 text-white'
          : 'text-gray-400 hover:bg-gray-800 hover:text-white'
      }`}
    >
      {item.icon}
      {!compact && (
        <span className="text-[10px] leading-none font-medium">{item.label}</span>
      )}
    </button>
  );

  const caption = (text: string) => (
    <span className="text-[9px] uppercase tracking-[0.12em] text-gray-600 px-1 pt-1.5 pb-0.5">
      {text}
    </span>
  );

  return (
    <nav
      aria-label="Режимы"
      className={`${
        compact ? 'w-12' : 'w-[88px]'
      } flex-shrink-0 bg-gray-900 border-r border-gray-800 flex flex-col gap-0.5 p-1.5 overflow-y-auto`}
    >
      {!compact && caption('Просмотр')}
      {viewing.map(button)}

      <div className="h-px bg-gray-800 mx-1 my-1.5" />

      {!compact && caption('Работа')}
      {working.map(button)}
    </nav>
  );
};
