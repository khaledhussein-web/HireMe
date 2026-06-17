export function OnboardingShell({
  eyebrow,
  title,
  subtitle,
  steps,
  step,
  completion,
  message,
  children,
  onBack,
  onContinue,
  onSaveLater,
  isSubmitting,
  finalLabel = 'Complete onboarding',
}) {
  const isLast = step === steps.length

  return (
    <main className="onboarding-page">
      <section className="onboarding-shell">
        <header className="onboarding-header">
          <div>
            <p className="section-kicker">{eyebrow}</p>
            <h1>{title}</h1>
            <p>{subtitle}</p>
          </div>
          <strong>{completion?.percentage ?? 0}% complete</strong>
        </header>
        <div className="progress-track" aria-label="Profile completion">
          <span style={{ width: `${completion?.percentage ?? 0}%` }} />
        </div>
        <ol className="step-list">
          {steps.map((label, index) => (
            <li className={index + 1 === step ? 'active' : ''} key={label}>
              <span>{index + 1}</span>
              {label}
            </li>
          ))}
        </ol>
        {message && (
          <div className={`auth-message ${message.type}`} role="alert">
            {message.text}
          </div>
        )}
        <div className="onboarding-content">{children}</div>
        <footer className="onboarding-actions">
          <button
            className="btn btn-secondary"
            type="button"
            disabled={step === 1 || isSubmitting}
            onClick={onBack}
          >
            Back
          </button>
          <button
            className="text-button"
            type="button"
            disabled={isSubmitting}
            onClick={onSaveLater}
          >
            Save and continue later
          </button>
          <button
            className="btn btn-primary"
            type="button"
            disabled={isSubmitting}
            onClick={onContinue}
          >
            {isSubmitting
              ? 'Saving...'
              : isLast
                ? finalLabel
                : 'Save and continue'}
          </button>
        </footer>
      </section>
    </main>
  )
}
