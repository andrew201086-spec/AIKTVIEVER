import React from 'react';
import { X } from 'lucide-react';

/** Every binding, in the order a new user meets them. */
export const SHORTCUTS: Array<{ keys: string[]; what: string }> = [
  { keys: ['↑', '↓'], what: 'предыдущий / следующий срез' },
  { keys: ['Page Up', 'Page Down'], what: 'на десять срезов' },
  { keys: ['1', '2', '3', '4'], what: 'перекрестье · яркость · сдвиг · масштаб' },
  { keys: ['L'], what: 'измерение длины' },
  { keys: ['A'], what: 'измерение угла' },
  { keys: ['B'], what: 'ширина × высота' },
  { keys: ['K', 'T', 'S', 'W'], what: 'окно: кость · зубы · мягкие ткани · весь диапазон' },
  { keys: ['P'], what: 'панорама' },
  { keys: ['C'], what: 'зубная формула' },
  { keys: ['D'], what: 'заключение' },
  { keys: ['I'], what: 'планирование имплантации' },
  { keys: ['V'], what: 'объём: обрезка, снимок, STL' },
  { keys: ['M'], what: 'отметить зуб (когда панорама открыта)' },
  { keys: ['F'], what: 'развернуть окно под курсором' },
  { keys: ['R'], what: 'сбросить камеры и яркость' },
  { keys: ['Esc'], what: 'выйти из развёрнутого окна или карточки' },
  { keys: ['?'], what: 'эта шпаргалка' },
];

/** Things that are not keys but are easy to miss. */
export const GESTURES: Array<{ what: string; how: string }> = [
  { what: 'Наклонные срезы', how: 'потяните за конец зелёной линии перекрестия — плоскости повернутся' },
  { what: 'Толщина слоя', how: 'ползунок «Слой» в панели инструментов; максимум показывает канал целиком' },
  { what: 'Планшет', how: 'на узком экране окна переключаются кнопками; один палец — перекрестие, два — масштаб' },
];

interface ShortcutHelpProps {
  onClose: () => void;
}

export const ShortcutHelp: React.FC<ShortcutHelpProps> = ({ onClose }) => (
  <div
    className="fixed inset-0 z-[60] bg-black/70 flex items-center justify-center p-4"
    onClick={onClose}
  >
    <div
      className="bg-gray-950 border border-gray-700 rounded-xl shadow-2xl max-w-md w-full"
      onClick={(event) => event.stopPropagation()}
    >
      <div className="flex items-center justify-between px-4 py-2.5 border-b border-gray-800">
        <h3 className="text-sm font-semibold text-white">Горячие клавиши</h3>
        <button
          onClick={onClose}
          className="p-1 rounded text-gray-400 hover:text-white hover:bg-gray-800"
          title="Закрыть (Esc)"
        >
          <X className="w-4 h-4" />
        </button>
      </div>

      <dl className="p-4 flex flex-col gap-2">
        {SHORTCUTS.map((shortcut) => (
          <div key={shortcut.what} className="flex items-baseline gap-3">
            <dt className="flex gap-1 flex-shrink-0 w-40">
              {shortcut.keys.map((key) => (
                <kbd
                  key={key}
                  className="px-1.5 py-0.5 text-[11px] font-mono bg-gray-800 border border-gray-700 border-b-2 rounded text-gray-200"
                >
                  {key}
                </kbd>
              ))}
            </dt>
            <dd className="text-xs text-gray-400">{shortcut.what}</dd>
          </div>
        ))}
      </dl>

      <div className="px-4 pb-3 flex flex-col gap-1.5">
        <h4 className="text-[11px] font-semibold text-gray-400 uppercase tracking-wide">
          Не только клавиши
        </h4>
        {GESTURES.map((gesture) => (
          <p key={gesture.what} className="text-[11px] text-gray-400">
            <b className="text-gray-300">{gesture.what}:</b> {gesture.how}
          </p>
        ))}
        <p className="text-[11px] text-gray-600 mt-1">
          Клавиши не работают, пока курсор в поле ввода.
        </p>
      </div>
    </div>
  </div>
);
