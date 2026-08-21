import type { ReactNode } from 'react'

/** 읽기 전용 필드. 수정 가능한 입력란과 시각적으로 구분되어야 한다. */
export function ReadOnlyField({
  label,
  value,
}: {
  label: string
  value: ReactNode
}) {
  return (
    <div>
      <dt className="text-xs font-medium text-slate-500">{label}</dt>
      <dd className="mt-1 rounded-md bg-slate-100 px-3 py-2 text-sm text-slate-700">
        {value === null || value === '' ? (
          <span className="text-slate-400">—</span>
        ) : (
          value
        )}
      </dd>
    </div>
  )
}

interface TextFieldProps {
  label: string
  name: string
  value: string
  onChange: (value: string) => void
  type?: string
  required?: boolean
  placeholder?: string
  error?: string
  disabled?: boolean
  /**
   * 비밀번호 입력란에는 반드시 지정한다.
   * 브라우저는 이 값으로 "로그인 중"과 "새 비밀번호 설정 중"을 구분한다.
   * 없으면 새 비밀번호 입력을 로그인으로 오해해 엉뚱한 저장·경고를 띄운다.
   */
  autoComplete?: string
}

export function TextField({
  label,
  name,
  value,
  onChange,
  type = 'text',
  required = false,
  placeholder,
  error,
  disabled = false,
  autoComplete,
}: TextFieldProps) {
  return (
    <div>
      <label
        htmlFor={name}
        className="block text-xs font-medium text-slate-600"
      >
        {label}
        {required && <span className="ml-0.5 text-rose-500">*</span>}
      </label>
      <input
        id={name}
        name={name}
        type={type}
        value={value}
        required={required}
        disabled={disabled}
        placeholder={placeholder}
        autoComplete={autoComplete}
        onChange={(e) => onChange(e.target.value)}
        className="mt-1 w-full rounded-md border-0 bg-white px-3 py-2 text-sm text-slate-900 ring-1 ring-inset ring-slate-300 focus:ring-2 focus:ring-inset focus:ring-slate-600 disabled:bg-slate-100"
      />
      {error && <p className="mt-1 text-xs text-rose-600">{error}</p>}
    </div>
  )
}

export function SelectField<T extends string>({
  label,
  name,
  value,
  options,
  onChange,
  disabled = false,
}: {
  label: string
  name: string
  value: T
  options: { value: T; label: string }[]
  onChange: (value: T) => void
  disabled?: boolean
}) {
  return (
    <div>
      <label htmlFor={name} className="block text-xs font-medium text-slate-600">
        {label}
      </label>
      <select
        id={name}
        name={name}
        value={value}
        disabled={disabled}
        onChange={(e) => onChange(e.target.value as T)}
        className="mt-1 w-full rounded-md border-0 bg-white px-3 py-2 text-sm text-slate-900 ring-1 ring-inset ring-slate-300 focus:ring-2 focus:ring-inset focus:ring-slate-600 disabled:bg-slate-100"
      >
        {options.map((o) => (
          <option key={o.value} value={o.value}>
            {o.label}
          </option>
        ))}
      </select>
    </div>
  )
}
