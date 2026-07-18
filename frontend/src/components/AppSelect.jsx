import * as Select from '@radix-ui/react-select';
import { Check, ChevronDown, ChevronUp } from 'lucide-react';

const EMPTY_VALUE = '__ldsm_empty__';

const AppSelect = ({
  value = '',
  onChange,
  options = [],
  placeholder = 'Seleccionar',
  ariaLabel,
  className = '',
  disabled = false,
}) => (
  <Select.Root
    value={value === '' ? EMPTY_VALUE : String(value)}
    onValueChange={(nextValue) => onChange(nextValue === EMPTY_VALUE ? '' : nextValue)}
    disabled={disabled}
  >
    <Select.Trigger className={`app-select-trigger ${className}`.trim()} aria-label={ariaLabel}>
      <Select.Value placeholder={placeholder} />
      <Select.Icon className="app-select-trigger__icon"><ChevronDown size={17} /></Select.Icon>
    </Select.Trigger>
    <Select.Portal>
      <Select.Content className="app-select-content" position="popper" sideOffset={6} collisionPadding={12}>
        <Select.ScrollUpButton className="app-select-scroll"><ChevronUp size={16} /></Select.ScrollUpButton>
        <Select.Viewport className="app-select-viewport">
          {options.map((option) => {
            const normalizedValue = option.value === '' ? EMPTY_VALUE : String(option.value);
            return (
              <Select.Item
                className="app-select-item"
                value={normalizedValue}
                disabled={option.disabled}
                key={normalizedValue}
              >
                <Select.ItemIndicator className="app-select-item__indicator"><Check size={16} /></Select.ItemIndicator>
                <Select.ItemText>{option.label}</Select.ItemText>
              </Select.Item>
            );
          })}
        </Select.Viewport>
        <Select.ScrollDownButton className="app-select-scroll"><ChevronDown size={16} /></Select.ScrollDownButton>
      </Select.Content>
    </Select.Portal>
  </Select.Root>
);

export default AppSelect;
