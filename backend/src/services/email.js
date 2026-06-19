import nodemailer from 'nodemailer'
import { env } from '../config/env.js'

let transporter

function mailTransporter() {
  if (transporter !== undefined) return transporter
  if (!env.smtp.host || !env.smtp.user || !env.smtp.password) {
    transporter = null
    return transporter
  }

  transporter = nodemailer.createTransport({
    host: env.smtp.host,
    port: env.smtp.port,
    secure: env.smtp.secure,
    auth: {
      user: env.smtp.user,
      pass: env.smtp.password,
    },
  })
  return transporter
}

export async function sendEmailMessage({ to, subject, text, html }) {
  const mailer = mailTransporter()
  if (!mailer) {
    console.info(`Development email to ${to}: ${subject}`)
    return { delivered: false, reason: 'SMTP is not configured.' }
  }

  await mailer.sendMail({ from: env.smtp.from, to, subject, text, html })
  return { delivered: true }
}

export async function sendVerificationEmail({ email, fullName, actionUrl }) {
  const mailer = mailTransporter()
  if (!mailer) {
    if (env.nodeEnv === 'production') {
      throw new Error('SMTP is not configured for verification email delivery.')
    }
    console.info(`Development verification link for ${email}: ${actionUrl}`)
    return
  }

  await mailer.sendMail({
    from: env.smtp.from,
    to: email,
    subject: 'Verify your HireMe account',
    text: `Hello ${fullName}, verify your HireMe account: ${actionUrl}`,
    html: `
      <p>Hello ${fullName},</p>
      <p>Your HireMe account was created successfully.</p>
      <p><a href="${actionUrl}">Verify your email address</a></p>
      <p>This link expires in 24 hours.</p>
    `,
  })
}
