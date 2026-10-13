import { useState } from 'react'
import { useLanguage } from '../i18n/LanguageContext.jsx'

const enquiryTypes = [
  'General Enquiry',
  'Farmer Support',
  'Product Enquiry',
  'Veterinary Professional',
  'Business Partnership',
  'Retail Partnership',
  'Supplier / Manufacturer',
  'Other'
]

const endpoint = import.meta.env.VITE_CONTACT_FORM_ENDPOINT || '/api/contact'

const initialState = { name: '', phone: '', email: '', enquiryType: enquiryTypes[0], message: '' }

export default function ContactForm({ defaultEnquiryType, title }) {
  const { translate } = useLanguage()
  const formTitle = title || translate('Send an Enquiry')
  const [values, setValues] = useState({
    ...initialState,
    enquiryType: defaultEnquiryType || enquiryTypes[0]
  })
  const [errors, setErrors] = useState({})
  const [status, setStatus] = useState('idle') // idle | loading | success | error | unconfigured

  const update = (field) => (e) => setValues((v) => ({ ...v, [field]: e.target.value }))

  const validate = () => {
    const next = {}
    if (!values.name.trim()) next.name = translate('Please enter your name.')
    if (!values.phone.trim()) next.phone = translate('Please enter a phone number.')
    if (values.email && !/^\S+@\S+\.\S+$/.test(values.email)) next.email = translate('Please enter a valid email.')
    if (!values.message.trim()) next.message = translate('Please enter a short message.')
    setErrors(next)
    return Object.keys(next).length === 0
  }

  const handleSubmit = async (e) => {
    e.preventDefault()
    if (!validate()) return

    if (!endpoint) {
      // No backend configured yet — see .env.example / VITE_CONTACT_FORM_ENDPOINT.
      // Do NOT fake a success state here: no request is actually sent, so no
      // enquiry is actually received. Tell the person plainly instead.
      setStatus('unconfigured')
      return
    }

    try {
      setStatus('loading')
      const res = await fetch(endpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(values)
      })
      if (!res.ok) throw new Error('Request failed')
      setStatus('success')
      setValues({ ...initialState, enquiryType: defaultEnquiryType || enquiryTypes[0] })
    } catch {
      setStatus('error')
    }
  }

  if (status === 'success') {
    return (
      <div className="card text-center" role="status">
        <h3 className="text-lg font-semibold text-ink">{translate('Thank you — your enquiry has been received')}</h3>
        <p className="mt-2 text-sm text-ink/60">
          {translate('The VillageVet team will get back to you shortly.')}
        </p>
        <button type="button" className="btn-secondary mt-6" onClick={() => setStatus('idle')}>
          {translate('Send another enquiry')}
        </button>
      </div>
    )
  }

  if (status === 'unconfigured') {
    return (
      <div className="card text-center" role="status">
        <h3 className="text-lg font-semibold text-ink">{translate("This form isn't connected yet")}</h3>
        <p className="mt-2 text-sm text-ink/60">
          {translate('Online submission hasn\'t been set up for this site yet, so nothing was sent. Please reach VillageVet directly for now —')}{' '}
          <a href="mailto:Subba.reddy@villagevetindia.com" className="font-medium text-brand hover:underline">Subba.reddy@villagevetindia.com</a> {translate('or')}{' '}
          <a href="tel:+919704420273" className="font-medium text-brand hover:underline">+91 97044 20273</a>.
        </p>
        <button type="button" className="btn-secondary mt-6" onClick={() => setStatus('idle')}>
          {translate('Back to form')}
        </button>
      </div>
    )
  }

  return (
    <form className="card space-y-5" onSubmit={handleSubmit} noValidate>
      <h3 className="text-lg font-semibold text-ink">{formTitle}</h3>

      <div>
        <label htmlFor="name" className="mb-1.5 block text-sm font-medium text-ink">{translate('Name')}</label>
        <input
          id="name"
          type="text"
          value={values.name}
          onChange={update('name')}
          className="w-full rounded-lg border border-ink/15 px-4 py-2.5 text-sm outline-none transition focus:border-brand"
          aria-invalid={!!errors.name}
          aria-describedby={errors.name ? 'name-error' : undefined}
        />
        {errors.name && <p id="name-error" role="alert" className="mt-1 text-xs text-red-600">{errors.name}</p>}
      </div>

      <div className="grid gap-5 sm:grid-cols-2">
        <div>
          <label htmlFor="phone" className="mb-1.5 block text-sm font-medium text-ink">{translate('Phone')}</label>
          <input
            id="phone"
            type="tel"
            value={values.phone}
            onChange={update('phone')}
            className="w-full rounded-lg border border-ink/15 px-4 py-2.5 text-sm outline-none transition focus:border-brand"
            aria-invalid={!!errors.phone}
            aria-describedby={errors.phone ? 'phone-error' : undefined}
          />
          {errors.phone && <p id="phone-error" role="alert" className="mt-1 text-xs text-red-600">{errors.phone}</p>}
        </div>
        <div>
          <label htmlFor="email" className="mb-1.5 block text-sm font-medium text-ink">{translate('Email (optional)')}</label>
          <input
            id="email"
            type="email"
            value={values.email}
            onChange={update('email')}
            className="w-full rounded-lg border border-ink/15 px-4 py-2.5 text-sm outline-none transition focus:border-brand"
            aria-invalid={!!errors.email}
            aria-describedby={errors.email ? 'email-error' : undefined}
          />
          {errors.email && <p id="email-error" role="alert" className="mt-1 text-xs text-red-600">{errors.email}</p>}
        </div>
      </div>

      <div>
        <label htmlFor="enquiryType" className="mb-1.5 block text-sm font-medium text-ink">{translate('Enquiry Type')}</label>
        <select
          id="enquiryType"
          value={values.enquiryType}
          onChange={update('enquiryType')}
          className="w-full rounded-lg border border-ink/15 bg-white px-4 py-2.5 text-sm outline-none transition focus:border-brand"
        >
          {enquiryTypes.map((t) => (
            <option key={t} value={t}>{translate(t)}</option>
          ))}
        </select>
      </div>

      <div>
        <label htmlFor="message" className="mb-1.5 block text-sm font-medium text-ink">{translate('Message')}</label>
        <textarea
          id="message"
          rows={4}
          value={values.message}
          onChange={update('message')}
          className="w-full resize-none rounded-lg border border-ink/15 px-4 py-2.5 text-sm outline-none transition focus:border-brand"
          aria-invalid={!!errors.message}
          aria-describedby={errors.message ? 'message-error' : undefined}
        />
        {errors.message && <p id="message-error" role="alert" className="mt-1 text-xs text-red-600">{errors.message}</p>}
      </div>

      {status === 'error' && (
        <p role="alert" className="text-sm text-red-600">
          {translate('Something went wrong sending your enquiry. Please try again, or reach us directly by phone or email.')}
        </p>
      )}

      <button
        type="submit"
        className="btn-primary w-full sm:w-auto"
        disabled={status === 'loading'}
        aria-busy={status === 'loading'}
      >
        {status === 'loading' ? translate('Sending…') : translate('Submit Enquiry')}
      </button>
    </form>
  )
}
