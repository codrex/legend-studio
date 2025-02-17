/**
 * Copyright (c) 2020-present, Goldman Sachs
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *     http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */

import { useApplicationStore } from '@finos/legend-application';
import {
  type TooltipPlacement,
  type InputActionData,
  Tooltip,
  DollarIcon,
  clsx,
  InfoCircleIcon,
  RefreshIcon,
  CheckSquareIcon,
  SquareIcon,
  CustomSelectorInput,
  SaveIcon,
  PencilIcon,
  DragPreviewLayer,
  FilledWindowMaximizeIcon,
  BasePopover,
  PanelFormSection,
  CalculateIcon,
  InputWithInlineValidation,
} from '@finos/legend-art';
import {
  type Enum,
  type Type,
  type ValueSpecification,
  type PureModel,
  PrimitiveInstanceValue,
  CollectionInstanceValue,
  EnumValueInstanceValue,
  INTERNAL__PropagatedValue,
  SimpleFunctionExpression,
  VariableExpression,
  EnumValueExplicitReference,
  PrimitiveType,
  PRIMITIVE_TYPE,
  GenericTypeExplicitReference,
  GenericType,
  Enumeration,
  getEnumValue,
  getMultiplicityDescription,
  type ObserverContext,
  matchFunctionName,
  isSubType,
} from '@finos/legend-graph';
import {
  type DebouncedFunc,
  type GeneratorFn,
  guaranteeNonNullable,
  isNonNullable,
  returnUndefOnError,
  uniq,
  parseCSVString,
  guaranteeIsNumber,
  csvStringify,
  guaranteeType,
} from '@finos/legend-shared';
import { flowResult } from 'mobx';
import { observer } from 'mobx-react-lite';
import {
  forwardRef,
  useEffect,
  useImperativeHandle,
  useRef,
  useState,
} from 'react';
import {
  instanceValue_setValue,
  instanceValue_setValues,
} from '../../stores/shared/ValueSpecificationModifierHelper.js';
import { CustomDatePicker } from './CustomDatePicker.js';
import { QUERY_BUILDER_SUPPORTED_FUNCTIONS } from '../../graph/QueryBuilderMetaModelConst.js';
import {
  isValidInstanceValue,
  simplifyValueExpression,
} from '../../stores/QueryBuilderValueSpecificationHelper.js';
import { evaluate } from 'mathjs';
import { isUsedDateFunctionSupportedInFormMode } from '../../stores/QueryBuilderStateBuilder.js';

type TypeCheckOption = {
  expectedType: Type;
  /**
   * Indicates if a strict type-matching will happen.
   * Sometimes, auto-boxing allow some rooms to wiggle,
   * for example we can assign a Float to an Integer, a
   * Date to a DateTime. With this flag set to `true`
   * we will not allow this.
   */
  match?: boolean;
};

export const VariableInfoTooltip: React.FC<{
  variable: VariableExpression;
  children: React.ReactElement;
  placement?: TooltipPlacement | undefined;
}> = (props) => {
  const { variable, children, placement } = props;
  const type = variable.genericType?.value.rawType;
  return (
    <Tooltip
      arrow={true}
      {...(placement !== undefined ? { placement } : {})}
      classes={{
        tooltip: 'value-spec-paramater__tooltip',
        arrow: 'value-spec-paramater__tooltip__arrow',
        tooltipPlacementRight: 'value-spec-paramater__tooltip--right',
      }}
      TransitionProps={{
        // disable transition
        // NOTE: somehow, this is the only workaround we have, if for example
        // we set `appear = true`, the tooltip will jump out of position
        timeout: 0,
      }}
      title={
        <div className="value-spec-paramater__tooltip__content">
          <div className="value-spec-paramater__tooltip__item">
            <div className="value-spec-paramater__tooltip__item__label">
              Type
            </div>
            <div className="value-spec-paramater__tooltip__item__value">
              {type?.name ?? '(unknown)'}
            </div>
          </div>
          <div className="value-spec-paramater__tooltip__item">
            <div className="value-spec-paramater__tooltip__item__label">
              Var Name
            </div>
            <div className="value-spec-paramater__tooltip__item__value">
              {variable.name}
            </div>
          </div>
          <div className="value-spec-paramater__tooltip__item">
            <div className="value-spec-paramater__tooltip__item__label">
              Multiplicity
            </div>
            <div className="value-spec-paramater__tooltip__item__value">
              {getMultiplicityDescription(variable.multiplicity)}
            </div>
          </div>
        </div>
      }
    >
      {children}
    </Tooltip>
  );
};

export const QUERY_BUILDER_VARIABLE_DND_TYPE = 'VARIABLE';

export interface QueryBuilderVariableDragSource {
  variable: VariableExpression;
}

const VariableExpressionParameterEditor = observer(
  (props: {
    valueSpecification: VariableExpression;
    resetValue: () => void;
    className?: string | undefined;
    isConstant?: boolean;
  }) => {
    const { valueSpecification, resetValue, isConstant, className } = props;
    const varName = valueSpecification.name;
    return (
      <>
        <DragPreviewLayer
          labelGetter={(item: QueryBuilderVariableDragSource): string =>
            item.variable.name
          }
          types={[QUERY_BUILDER_VARIABLE_DND_TYPE]}
        />
        <div
          className={clsx('value-spec-editor__variable', className, {
            'value-spec-editor__variable__constant': isConstant,
          })}
        >
          <div className="value-spec-editor__variable__icon">
            {isConstant ? <div className="icon">C</div> : <DollarIcon />}
          </div>
          <div className="value-spec-editor__variable__label">
            <div className="value-spec-editor__variable__text">{varName}</div>
            <VariableInfoTooltip variable={valueSpecification}>
              <div className="value-spec-editor__variable__info">
                <InfoCircleIcon />
              </div>
            </VariableInfoTooltip>

            <button
              className="value-spec-editor__variable__reset-btn"
              name="Reset"
              title="Reset"
              onClick={resetValue}
            >
              <RefreshIcon />
            </button>
          </div>
        </div>
      </>
    );
  },
);

const StringPrimitiveInstanceValueEditor = observer(
  forwardRef<
    HTMLInputElement,
    {
      valueSpecification: PrimitiveInstanceValue;
      className?: string | undefined;
      setValueSpecification: (val: ValueSpecification) => void;
      resetValue: () => void;
      selectorConfig?:
        | {
            values: string[] | undefined;
            isLoading: boolean;
            reloadValues:
              | DebouncedFunc<(inputValue: string) => GeneratorFn<void>>
              | undefined;
            cleanUpReloadValues?: () => void;
          }
        | undefined;
      obseverContext: ObserverContext;
    }
  >(function StringPrimitiveInstanceValueEditor(props, ref) {
    const {
      valueSpecification,
      className,
      resetValue,
      setValueSpecification,
      selectorConfig,
      obseverContext,
    } = props;
    const useSelector = Boolean(selectorConfig);
    const applicationStore = useApplicationStore();
    const value = valueSpecification.values[0] as string | null;
    const updateValueSpec = (val: string): void => {
      instanceValue_setValue(valueSpecification, val, 0, obseverContext);
      setValueSpecification(valueSpecification);
    };
    const changeInputValue: React.ChangeEventHandler<HTMLInputElement> = (
      event,
    ) => {
      updateValueSpec(event.target.value);
    };
    // custom select
    const selectedValue = { value: value, label: value };
    const reloadValuesFunc = selectorConfig?.reloadValues;
    const changeValue = (
      val: null | { value: number | string; label: string },
    ): void => {
      const newValue = val === null ? '' : val.value.toString();
      updateValueSpec(newValue);
    };
    const handleInputChange = (
      inputValue: string,
      actionChange: InputActionData,
    ): void => {
      if (actionChange.action === 'input-change') {
        updateValueSpec(inputValue);
        reloadValuesFunc?.cancel();
        const reloadValuesFuncTransformation = reloadValuesFunc?.(inputValue);
        if (reloadValuesFuncTransformation) {
          flowResult(reloadValuesFuncTransformation).catch(
            applicationStore.alertUnhandledError,
          );
        }
      }
      if (actionChange.action === 'input-blur') {
        reloadValuesFunc?.cancel();
        selectorConfig?.cleanUpReloadValues?.();
      }
    };
    const isLoading = selectorConfig?.isLoading;
    const queryOptions = selectorConfig?.values?.length
      ? selectorConfig.values.map((e) => ({
          value: e,
          label: e.toString(),
        }))
      : undefined;
    const noOptionsMessage =
      selectorConfig?.values === undefined ? (): null => null : undefined;

    return (
      <div className={clsx('value-spec-editor', className)}>
        {useSelector ? (
          <CustomSelectorInput
            className="value-spec-editor__enum-selector"
            options={queryOptions}
            onChange={changeValue}
            value={selectedValue.label === '' ? '' : selectedValue}
            inputValue={value ?? ''}
            onInputChange={handleInputChange}
            darkMode={
              !applicationStore.layoutService
                .TEMPORARY__isLightColorThemeEnabled
            }
            isLoading={isLoading}
            allowCreateWhileLoading={true}
            noOptionsMessage={noOptionsMessage}
            components={{
              DropdownIndicator: null,
            }}
            hasError={!isValidInstanceValue(valueSpecification)}
            placeholder={value === '' ? '(empty)' : undefined}
          />
        ) : (
          <InputWithInlineValidation
            className="panel__content__form__section__input value-spec-editor__input"
            spellCheck={false}
            value={value ?? ''}
            placeholder={value === '' ? '(empty)' : undefined}
            onChange={changeInputValue}
            ref={ref}
            error={
              !isValidInstanceValue(valueSpecification)
                ? 'Invalid String value'
                : undefined
            }
          />
        )}
        <button
          className="value-spec-editor__reset-btn"
          name="Reset"
          title="Reset"
          onClick={resetValue}
        >
          <RefreshIcon />
        </button>
      </div>
    );
  }),
);

const BooleanPrimitiveInstanceValueEditor = observer(
  (props: {
    valueSpecification: PrimitiveInstanceValue;
    className?: string | undefined;
    resetValue: () => void;
    setValueSpecification: (val: ValueSpecification) => void;
    obseverContext: ObserverContext;
  }) => {
    const {
      valueSpecification,
      className,
      resetValue,
      setValueSpecification,
      obseverContext,
    } = props;
    const value = valueSpecification.values[0] as boolean;
    const toggleValue = (): void => {
      instanceValue_setValue(valueSpecification, !value, 0, obseverContext);
      setValueSpecification(valueSpecification);
    };

    return (
      <div className={clsx('value-spec-editor', className)}>
        <button
          className={clsx('value-spec-editor__toggler__btn', {
            'value-spec-editor__toggler__btn--toggled': value,
          })}
          onClick={toggleValue}
        >
          {value ? <CheckSquareIcon /> : <SquareIcon />}
        </button>
        <button
          className="value-spec-editor__reset-btn"
          name="Reset"
          title="Reset"
          onClick={resetValue}
        >
          <RefreshIcon />
        </button>
      </div>
    );
  },
);

const NumberPrimitiveInstanceValueEditor = observer(
  forwardRef<
    HTMLInputElement,
    {
      valueSpecification: PrimitiveInstanceValue;
      isInteger: boolean;
      className?: string | undefined;
      resetValue: () => void;
      setValueSpecification: (val: ValueSpecification) => void;
      obseverContext: ObserverContext;
    }
  >(function NumberPrimitiveInstanceValueEditor(props, ref) {
    const {
      valueSpecification,
      isInteger,
      className,
      resetValue,
      setValueSpecification,
      obseverContext,
    } = props;
    const [value, setValue] = useState(
      valueSpecification.values[0] === null
        ? ''
        : (valueSpecification.values[0] as number).toString(),
    );
    const inputRef = useRef<HTMLInputElement>(null);
    useImperativeHandle(ref, () => inputRef.current as HTMLInputElement, []);
    const numericValue = value
      ? isInteger
        ? Number.parseInt(Number(value).toString(), 10)
        : Number(value)
      : null;

    const updateValueSpecIfValid = (val: string): void => {
      if (val) {
        const parsedValue = isInteger
          ? Number.parseInt(Number(val).toString(), 10)
          : Number(val);
        if (
          !isNaN(parsedValue) &&
          parsedValue !== valueSpecification.values[0]
        ) {
          instanceValue_setValue(
            valueSpecification,
            parsedValue,
            0,
            obseverContext,
          );
          setValueSpecification(valueSpecification);
        }
      } else {
        resetValue();
      }
    };

    const handleInputChange: React.ChangeEventHandler<HTMLInputElement> = (
      event,
    ) => {
      setValue(event.target.value);
      updateValueSpecIfValid(event.target.value);
    };

    // Support expression evaluation
    const calculateExpression = (): void => {
      if (numericValue !== null && isNaN(numericValue)) {
        // If the value is not a number, try to evaluate it as an expression
        try {
          const calculatedValue = guaranteeIsNumber(evaluate(value));
          updateValueSpecIfValid(calculatedValue.toString());
          setValue(calculatedValue.toString());
        } catch {
          // If we fail to evaluate the expression, we just keep the previous value
          const prevValue =
            valueSpecification.values[0] !== null &&
            valueSpecification.values[0] !== undefined
              ? valueSpecification.values[0].toString()
              : '';
          updateValueSpecIfValid(prevValue);
          setValue(prevValue);
        }
      } else if (numericValue !== null) {
        // If numericValue is a number, update the value spec
        updateValueSpecIfValid(numericValue.toString());
        setValue(numericValue.toString());
      } else {
        // If numericValue is null, reset the value spec
        resetValue();
      }
    };

    const onKeyDown: React.KeyboardEventHandler<HTMLInputElement> = (event) => {
      if (event.code === 'Enter') {
        calculateExpression();
        inputRef.current?.focus();
      } else if (event.code === 'Escape') {
        inputRef.current?.select();
      }
    };

    useEffect(() => {
      if (
        numericValue !== null &&
        !isNaN(numericValue) &&
        numericValue !== valueSpecification.values[0]
      ) {
        const valueFromValueSpec =
          valueSpecification.values[0] !== null
            ? (valueSpecification.values[0] as number).toString()
            : '';
        setValue(valueFromValueSpec);
      }
    }, [numericValue, valueSpecification]);

    return (
      <div className={clsx('value-spec-editor', className)}>
        <div className="value-spec-editor__number__input-container">
          <input
            ref={inputRef}
            className={clsx(
              'panel__content__form__section__input',
              'value-spec-editor__input',
              'value-spec-editor__number__input',
              {
                'value-spec-editor__number__input--error':
                  !isValidInstanceValue(valueSpecification),
              },
            )}
            spellCheck={false}
            type="text" // NOTE: we leave this as text so that we can support expression evaluation
            inputMode="numeric"
            value={value}
            onChange={handleInputChange}
            onBlur={calculateExpression}
            onKeyDown={onKeyDown}
          />
          <div className="value-spec-editor__number__actions">
            <button
              className="value-spec-editor__number__action"
              title="Evaluate Expression (Enter)"
              onClick={calculateExpression}
            >
              <CalculateIcon />
            </button>
          </div>
        </div>
        <button
          className="value-spec-editor__reset-btn"
          name="Reset"
          title="Reset"
          onClick={resetValue}
        >
          <RefreshIcon />
        </button>
      </div>
    );
  }),
);

const EnumValueInstanceValueEditor = observer(
  (props: {
    valueSpecification: EnumValueInstanceValue;
    className?: string | undefined;
    setValueSpecification: (val: ValueSpecification) => void;
    resetValue: () => void;
    obseverContext: ObserverContext;
  }) => {
    const {
      valueSpecification,
      className,
      resetValue,
      setValueSpecification,
      obseverContext,
    } = props;
    const applicationStore = useApplicationStore();
    const enumType = guaranteeType(
      valueSpecification.genericType?.value.rawType,
      Enumeration,
    );
    const enumValue =
      valueSpecification.values[0] === undefined
        ? null
        : valueSpecification.values[0].value;
    const options = enumType.values.map((value) => ({
      label: value.name,
      value: value,
    }));
    const changeValue = (val: { value: Enum; label: string }): void => {
      instanceValue_setValue(
        valueSpecification,
        EnumValueExplicitReference.create(val.value),
        0,
        obseverContext,
      );
      setValueSpecification(valueSpecification);
    };

    return (
      <div className={clsx('value-spec-editor', className)}>
        <CustomSelectorInput
          className="value-spec-editor__enum-selector"
          options={options}
          onChange={changeValue}
          value={enumValue ? { value: enumValue, label: enumValue.name } : null}
          darkMode={
            !applicationStore.layoutService.TEMPORARY__isLightColorThemeEnabled
          }
          hasError={!isValidInstanceValue(valueSpecification)}
          placeholder="Select value"
        />
        <button
          className="value-spec-editor__reset-btn"
          name="Reset"
          title="Reset"
          onClick={resetValue}
        >
          <RefreshIcon />
        </button>
      </div>
    );
  },
);

const stringifyValue = (values: ValueSpecification[]): string => {
  if (values.length === 0) {
    return '';
  }
  return csvStringify([
    values
      .map((val) => {
        if (val instanceof PrimitiveInstanceValue) {
          return val.values[0];
        } else if (val instanceof EnumValueInstanceValue) {
          return guaranteeNonNullable(val.values[0]).value.name;
        }
        return undefined;
      })
      .filter(isNonNullable),
  ]).trim();
};

/**
 * NOTE: We attempt to be less disruptive here by not throwing errors left and right, instead
 * we silently remove values which are not valid or parsable. But perhaps, we can consider
 * passing in logger or notifier to show give the users some idea of what went wrong instead
 * of silently swallow parts of their inputs like this.
 */
const setCollectionValue = (
  valueSpecification: CollectionInstanceValue,
  expectedType: Type,
  value: string,
  obseverContext: ObserverContext,
): void => {
  if (value.trim().length === 0) {
    instanceValue_setValues(valueSpecification, [], obseverContext);
    return;
  }
  let result: unknown[] = [];

  const parseData = parseCSVString(value);

  if (!parseData) {
    return;
  }

  if (expectedType instanceof PrimitiveType) {
    switch (expectedType.path) {
      case PRIMITIVE_TYPE.STRING: {
        result = uniq(parseData)
          .map((item): PrimitiveInstanceValue | undefined => {
            const primitiveInstanceValue = new PrimitiveInstanceValue(
              GenericTypeExplicitReference.create(
                new GenericType(expectedType),
              ),
            );
            instanceValue_setValues(
              primitiveInstanceValue,
              [item.toString()],
              obseverContext,
            );
            return primitiveInstanceValue;
          })
          .filter(isNonNullable);
        break;
      }
      case PRIMITIVE_TYPE.NUMBER:
      case PRIMITIVE_TYPE.FLOAT:
      case PRIMITIVE_TYPE.DECIMAL:
      case PRIMITIVE_TYPE.INTEGER: {
        result = uniq(
          parseData
            .filter((val) => !isNaN(Number(val)))
            .map((val) => Number(val)),
        )
          .map((item): PrimitiveInstanceValue | undefined => {
            const primitiveInstanceValue = new PrimitiveInstanceValue(
              GenericTypeExplicitReference.create(
                new GenericType(expectedType),
              ),
            );
            instanceValue_setValues(
              primitiveInstanceValue,
              [item],
              obseverContext,
            );
            return primitiveInstanceValue;
          })
          .filter(isNonNullable);
        break;
      }
      case PRIMITIVE_TYPE.DATE:
      case PRIMITIVE_TYPE.STRICTDATE: {
        result = uniq(
          parseData
            .filter((val) => !isNaN(Date.parse(val)))
            .map((val) => val.trim()),
        )
          .map((item): PrimitiveInstanceValue | undefined => {
            const primitiveInstanceValue = new PrimitiveInstanceValue(
              GenericTypeExplicitReference.create(
                new GenericType(expectedType),
              ),
            );
            instanceValue_setValues(
              primitiveInstanceValue,
              [item],
              obseverContext,
            );
            return primitiveInstanceValue;
          })
          .filter(isNonNullable);
        break;
      }
      case PRIMITIVE_TYPE.DATETIME: {
        result = uniq(
          parseData
            .filter(
              (val) =>
                (!isNaN(Date.parse(val)) && new Date(val).getTime()) ||
                (val.includes('%') &&
                  !isNaN(Date.parse(val.slice(1))) &&
                  new Date(val.slice(1)).getTime()),
            )
            .map((val) => val.trim()),
        )
          .map((item): PrimitiveInstanceValue | undefined => {
            const primitiveInstanceValue = new PrimitiveInstanceValue(
              GenericTypeExplicitReference.create(
                new GenericType(expectedType),
              ),
            );
            instanceValue_setValues(
              primitiveInstanceValue,
              [item],
              obseverContext,
            );
            return primitiveInstanceValue;
          })
          .filter(isNonNullable);
        break;
      }
      default:
        // unsupported expected type, just escape
        return;
    }
  } else if (expectedType instanceof Enumeration) {
    result = uniq(parseData.map((item) => item.trim()))
      .map((item): EnumValueInstanceValue | undefined => {
        const _enum = returnUndefOnError(() =>
          getEnumValue(expectedType, item),
        );
        if (!_enum) {
          return undefined;
        }
        const enumValueInstanceValue = new EnumValueInstanceValue(
          GenericTypeExplicitReference.create(new GenericType(expectedType)),
        );
        instanceValue_setValues(
          enumValueInstanceValue,
          [EnumValueExplicitReference.create(_enum)],
          obseverContext,
        );
        return enumValueInstanceValue;
      })
      .filter(isNonNullable);
  }
  instanceValue_setValues(valueSpecification, result, obseverContext);
};

const EnumCollectionInstanceValueEditor = observer(
  (props: {
    valueSpecification: CollectionInstanceValue;
    observerContext: ObserverContext;
    saveEdit: () => void;
  }) => {
    const { valueSpecification, observerContext, saveEdit } = props;
    const applicationStore = useApplicationStore();
    const enumType = guaranteeType(
      valueSpecification.genericType?.value.rawType,
      Enumeration,
    );

    const [selectedOptions, setSelectedOptions] = useState<
      { label: string; value: Enum }[]
    >(
      (valueSpecification.values as EnumValueInstanceValue[])
        .filter((valueSpec) => valueSpec.values[0]?.value !== undefined)
        .map((valueSpec) => ({
          label: valueSpec.values[0]!.value.name,
          value: valueSpec.values[0]!.value,
        })),
    );

    const availableOptions = enumType.values
      .filter(
        (value) =>
          !selectedOptions.some(
            (selectedValue) => selectedValue.value.name === value.name,
          ),
      )
      .map((value) => ({
        label: value.name,
        value: value,
      }));

    const changeValue = (
      newSelectedOptions: { value: Enum; label: string }[],
    ): void => {
      setSelectedOptions(newSelectedOptions);
    };

    const updateValueSpecAndSaveEdit = (): void => {
      const result = selectedOptions
        .map((value) => {
          const enumValueInstanceValue = new EnumValueInstanceValue(
            GenericTypeExplicitReference.create(new GenericType(enumType)),
          );
          instanceValue_setValues(
            enumValueInstanceValue,
            [EnumValueExplicitReference.create(value.value)],
            observerContext,
          );
          return enumValueInstanceValue;
        })
        .filter(isNonNullable);
      instanceValue_setValues(valueSpecification, result, observerContext);
      saveEdit();
    };

    return (
      <>
        <CustomSelectorInput
          className="value-spec-editor__enum-collection-selector"
          options={availableOptions}
          isMulti={true}
          onChange={changeValue}
          onBlur={updateValueSpecAndSaveEdit}
          onKeyDown={(event: KeyboardEvent): void => {
            if (event.key === 'Enter' && !event.shiftKey) {
              updateValueSpecAndSaveEdit();
            }
          }}
          value={selectedOptions}
          darkMode={
            !applicationStore.layoutService.TEMPORARY__isLightColorThemeEnabled
          }
          placeholder="Select value"
          autoFocus={true}
          menuIsOpen={true}
        />
        <button
          className="value-spec-editor__list-editor__save-button btn--dark"
          onClick={updateValueSpecAndSaveEdit}
        >
          <SaveIcon />
        </button>
      </>
    );
  },
);

const COLLECTION_PREVIEW_CHAR_LIMIT = 50;

const getPlaceHolder = (expectedType: Type): string => {
  if (expectedType instanceof PrimitiveType) {
    switch (expectedType.path) {
      case PRIMITIVE_TYPE.DATE:
      case PRIMITIVE_TYPE.STRICTDATE:
        return 'yyyy-mm-dd';
      case PRIMITIVE_TYPE.DATETIME:
        return 'yyyy-mm-ddThh:mm:ss';
      default:
        return '(empty)';
    }
  }
  return '(empty)';
};

const CollectionValueInstanceValueEditor = observer(
  (props: {
    valueSpecification: CollectionInstanceValue;
    graph: PureModel;
    expectedType: Type;
    className?: string | undefined;
    resetValue: () => void;
    setValueSpecification: (val: ValueSpecification) => void;
    obseverContext: ObserverContext;
  }) => {
    const {
      valueSpecification,
      expectedType,
      className,
      resetValue,
      setValueSpecification,
      obseverContext,
    } = props;
    const inputRef = useRef<HTMLTextAreaElement>(null);

    const [text, setText] = useState(stringifyValue(valueSpecification.values));
    const [editable, setEditable] = useState(false);
    const [showAdvancedEditorPopover, setShowAdvancedEditorPopover] =
      useState(false);
    const valueText = stringifyValue(valueSpecification.values);
    const previewText = `List(${
      valueSpecification.values.length === 0
        ? 'empty'
        : valueSpecification.values.length
    })${
      valueSpecification.values.length === 0
        ? ''
        : `: ${
            valueText.length > COLLECTION_PREVIEW_CHAR_LIMIT
              ? `${valueText.substring(0, COLLECTION_PREVIEW_CHAR_LIMIT)}...`
              : valueText
          }`
    }`;
    const enableEdit = (): void => setEditable(true);
    const saveEdit = (): void => {
      if (editable) {
        setEditable(false);
        setShowAdvancedEditorPopover(false);
        setValueSpecification(valueSpecification);
      }
    };
    const updateValueSpecAndSaveEdit = (): void => {
      if (editable) {
        setCollectionValue(
          valueSpecification,
          expectedType,
          text,
          obseverContext,
        );
        setText(stringifyValue(valueSpecification.values));
        saveEdit();
      }
    };

    const changeValueTextArea: React.ChangeEventHandler<HTMLTextAreaElement> = (
      event,
    ) => {
      setText(event.target.value);
    };
    const expandButtonName = `${valueSpecification.hashCode}ExpandButton`;
    const handleOnBlur: React.FocusEventHandler<HTMLTextAreaElement> = (
      event,
    ) => {
      // disable save if target is expand button
      if (
        (event.relatedTarget as HTMLButtonElement | undefined)?.name !==
        expandButtonName
      ) {
        updateValueSpecAndSaveEdit();
      }
    };

    const placeholder = text === '' ? getPlaceHolder(expectedType) : undefined;

    // focus the input box when edit is enabled
    useEffect(() => {
      if (editable) {
        inputRef.current?.focus();
      }
    }, [editable]);

    if (editable) {
      return (
        <>
          {showAdvancedEditorPopover && (
            <BasePopover
              onClose={() => setShowAdvancedEditorPopover(false)}
              open={showAdvancedEditorPopover}
              anchorEl={inputRef.current}
            >
              <textarea
                className="panel__content__form__section__input value-spec-editor__list-editor__textarea"
                spellCheck={false}
                value={text}
                placeholder={placeholder}
                onChange={changeValueTextArea}
                onKeyDown={(event): void => {
                  if (event.key === 'Enter' && !event.shiftKey) {
                    updateValueSpecAndSaveEdit();
                  }
                }}
              />
              <PanelFormSection>
                <div className="value-spec-editor__list-editor__textarea__description">
                  Hit Enter to Apply Change
                </div>
              </PanelFormSection>
            </BasePopover>
          )}
          <div className={clsx('value-spec-editor', className)}>
            {expectedType instanceof Enumeration ? (
              <EnumCollectionInstanceValueEditor
                valueSpecification={valueSpecification}
                observerContext={obseverContext}
                saveEdit={saveEdit}
              />
            ) : (
              <>
                <textarea
                  ref={inputRef}
                  className={clsx(
                    'panel__content__form__section__input value-spec-editor__input value-spec-editor__textarea ',
                  )}
                  spellCheck={false}
                  value={text}
                  placeholder={placeholder}
                  onChange={changeValueTextArea}
                  onKeyDown={(event): void => {
                    if (event.key === 'Enter' && !event.shiftKey) {
                      updateValueSpecAndSaveEdit();
                    }
                  }}
                  onBlur={handleOnBlur}
                />
                <button
                  className="value-spec-editor__list-editor__expand-button btn--dark"
                  onClick={() => setShowAdvancedEditorPopover(true)}
                  tabIndex={-1}
                  name={expandButtonName}
                  title="Expand window..."
                >
                  <FilledWindowMaximizeIcon />
                </button>
                <button
                  className="value-spec-editor__list-editor__save-button btn--dark"
                  onClick={saveEdit}
                >
                  <SaveIcon />
                </button>
              </>
            )}
            <button
              className="value-spec-editor__reset-btn"
              name="Reset"
              title="Reset"
              onClick={resetValue}
            >
              <RefreshIcon />
            </button>
          </div>
        </>
      );
    }
    return (
      <div
        className={clsx('value-spec-editor', className)}
        onClick={enableEdit}
        title="Click to edit"
      >
        <div
          className={clsx('value-spec-editor__list-editor__preview', {
            'value-spec-editor__list-editor__preview--error':
              !isValidInstanceValue(valueSpecification),
          })}
        >
          {previewText}
        </div>
        <button className="value-spec-editor__list-editor__edit-icon">
          <PencilIcon />
        </button>
      </div>
    );
  },
);

const UnsupportedValueSpecificationEditor: React.FC = () => (
  <div className="value-spec-editor--unsupported">unsupported</div>
);

const DateInstanceValueEditor = observer(
  (props: {
    valueSpecification: PrimitiveInstanceValue | SimpleFunctionExpression;
    graph: PureModel;
    obseverContext: ObserverContext;
    typeCheckOption: TypeCheckOption;
    className?: string | undefined;
    setValueSpecification: (val: ValueSpecification) => void;
    resetValue: () => void;
  }) => {
    const {
      valueSpecification,
      setValueSpecification,
      graph,
      obseverContext,
      typeCheckOption,
      resetValue,
    } = props;

    return (
      <div className="value-spec-editor">
        <CustomDatePicker
          valueSpecification={valueSpecification}
          graph={graph}
          observerContext={obseverContext}
          typeCheckOption={typeCheckOption}
          setValueSpecification={setValueSpecification}
          hasError={
            valueSpecification instanceof PrimitiveInstanceValue &&
            !isValidInstanceValue(valueSpecification)
          }
        />
        <button
          className="value-spec-editor__reset-btn"
          name="Reset"
          title="Reset"
          onClick={resetValue}
        >
          <RefreshIcon />
        </button>
      </div>
    );
  },
);

/**
 * TODO we should pass in the props `resetValueSpecification`. Reset
 * should be part of this editor. Also through here we can call `observe_` accordingly.
 *
 * See https://github.com/finos/legend-studio/pull/1021
 */
export const BasicValueSpecificationEditor = forwardRef<
  HTMLInputElement,
  {
    valueSpecification: ValueSpecification;
    graph: PureModel;
    obseverContext: ObserverContext;
    typeCheckOption: TypeCheckOption;
    className?: string | undefined;
    setValueSpecification: (val: ValueSpecification) => void;
    resetValue: () => void;
    isConstant?: boolean;
    selectorConfig?:
      | {
          values: string[] | undefined;
          isLoading: boolean;
          reloadValues:
            | DebouncedFunc<(inputValue: string) => GeneratorFn<void>>
            | undefined;
          cleanUpReloadValues?: () => void;
        }
      | undefined;
  }
>(function BasicValueSpecificationEditor(props, ref) {
  const {
    className,
    valueSpecification,
    graph,
    obseverContext,
    typeCheckOption,
    setValueSpecification,
    resetValue,
    selectorConfig,
    isConstant,
  } = props;
  if (valueSpecification instanceof PrimitiveInstanceValue) {
    const _type = valueSpecification.genericType.value.rawType;
    switch (_type.path) {
      case PRIMITIVE_TYPE.STRING:
        return (
          <StringPrimitiveInstanceValueEditor
            valueSpecification={valueSpecification}
            setValueSpecification={setValueSpecification}
            className={className}
            resetValue={resetValue}
            selectorConfig={selectorConfig}
            obseverContext={obseverContext}
            ref={ref}
          />
        );
      case PRIMITIVE_TYPE.BOOLEAN:
        return (
          <BooleanPrimitiveInstanceValueEditor
            valueSpecification={valueSpecification}
            setValueSpecification={setValueSpecification}
            className={className}
            resetValue={resetValue}
            obseverContext={obseverContext}
          />
        );
      case PRIMITIVE_TYPE.NUMBER:
      case PRIMITIVE_TYPE.FLOAT:
      case PRIMITIVE_TYPE.DECIMAL:
      case PRIMITIVE_TYPE.BINARY:
      case PRIMITIVE_TYPE.BYTE:
      case PRIMITIVE_TYPE.INTEGER:
        return (
          <NumberPrimitiveInstanceValueEditor
            valueSpecification={valueSpecification}
            isInteger={_type.path === PRIMITIVE_TYPE.INTEGER}
            setValueSpecification={setValueSpecification}
            className={className}
            resetValue={resetValue}
            obseverContext={obseverContext}
            ref={ref}
          />
        );
      case PRIMITIVE_TYPE.DATE:
      case PRIMITIVE_TYPE.STRICTDATE:
      case PRIMITIVE_TYPE.DATETIME:
      case PRIMITIVE_TYPE.LATESTDATE:
        return (
          <DateInstanceValueEditor
            valueSpecification={valueSpecification}
            graph={graph}
            obseverContext={obseverContext}
            typeCheckOption={typeCheckOption}
            className={className}
            setValueSpecification={setValueSpecification}
            resetValue={resetValue}
          />
        );
      default:
        return <UnsupportedValueSpecificationEditor />;
    }
  } else if (valueSpecification instanceof EnumValueInstanceValue) {
    return (
      <EnumValueInstanceValueEditor
        valueSpecification={valueSpecification}
        className={className}
        resetValue={resetValue}
        setValueSpecification={setValueSpecification}
        obseverContext={obseverContext}
      />
    );
  } else if (
    valueSpecification instanceof CollectionInstanceValue &&
    valueSpecification.genericType
  ) {
    // NOTE: since when we fill in the arguments, `[]` (or `nullish` value in Pure)
    // is used for parameters we don't handle, we should not attempt to support empty collection
    // without generic type here as that  is equivalent to `[]`
    return (
      <CollectionValueInstanceValueEditor
        valueSpecification={valueSpecification}
        graph={graph}
        expectedType={typeCheckOption.expectedType}
        className={className}
        resetValue={resetValue}
        setValueSpecification={setValueSpecification}
        obseverContext={obseverContext}
      />
    );
  }
  // property expression
  else if (valueSpecification instanceof VariableExpression) {
    return (
      <VariableExpressionParameterEditor
        valueSpecification={valueSpecification}
        className={className}
        resetValue={resetValue}
        isConstant={Boolean(isConstant)}
      />
    );
  } else if (valueSpecification instanceof INTERNAL__PropagatedValue) {
    return (
      <BasicValueSpecificationEditor
        valueSpecification={valueSpecification.getValue()}
        graph={graph}
        obseverContext={obseverContext}
        typeCheckOption={typeCheckOption}
        setValueSpecification={setValueSpecification}
        resetValue={resetValue}
      />
    );
  } else if (valueSpecification instanceof SimpleFunctionExpression) {
    if (isSubType(typeCheckOption.expectedType, PrimitiveType.DATE)) {
      if (isUsedDateFunctionSupportedInFormMode(valueSpecification)) {
        return (
          <DateInstanceValueEditor
            valueSpecification={valueSpecification}
            graph={graph}
            obseverContext={obseverContext}
            typeCheckOption={typeCheckOption}
            className={className}
            setValueSpecification={setValueSpecification}
            resetValue={resetValue}
          />
        );
      } else {
        return <UnsupportedValueSpecificationEditor />;
      }
    } else if (
      // TODO: think of other ways we could make use of this code path where we can simplify
      // an expression value to simple value, not just handling minus() function only
      isSubType(typeCheckOption.expectedType, PrimitiveType.NUMBER) &&
      matchFunctionName(
        valueSpecification.functionName,
        QUERY_BUILDER_SUPPORTED_FUNCTIONS.MINUS,
      )
    ) {
      const simplifiedValue = simplifyValueExpression(
        valueSpecification,
        obseverContext,
      );
      if (
        simplifiedValue instanceof PrimitiveInstanceValue &&
        isSubType(
          simplifiedValue.genericType.value.rawType,
          PrimitiveType.NUMBER,
        )
      ) {
        return (
          <NumberPrimitiveInstanceValueEditor
            valueSpecification={simplifiedValue}
            isInteger={
              simplifiedValue.genericType.value.rawType ===
              PrimitiveType.INTEGER
            }
            setValueSpecification={setValueSpecification}
            className={className}
            resetValue={resetValue}
            obseverContext={obseverContext}
            ref={ref}
          />
        );
      }
    }
  }

  return <UnsupportedValueSpecificationEditor />;
});
