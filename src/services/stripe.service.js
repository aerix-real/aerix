const Stripe = require("stripe");

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY || "");

class StripeService {
  async createCheckoutSession({ user }) {
    if (!user?.id || !user?.email) {
      throw new Error("Usuário inválido para checkout.");
    }

    if (!process.env.STRIPE_SECRET_KEY) {
      throw new Error("STRIPE_SECRET_KEY não configurado.");
    }

    if (!process.env.STRIPE_PRICE_PREMIUM_MONTHLY) {
      throw new Error("STRIPE_PRICE_PREMIUM_MONTHLY não configurado.");
    }

    const appUrl = process.env.APP_URL || "http://localhost:3000";

    return stripe.checkout.sessions.create({
      mode: "subscription",
      customer_email: user.email,
      line_items: [
        {
          price: process.env.STRIPE_PRICE_PREMIUM_MONTHLY,
          quantity: 1
        }
      ],
      success_url: `${appUrl}/?billing=success`,
      cancel_url: `${appUrl}/?billing=cancel`,
      metadata: {
        user_id: String(user.id),
        email: user.email
      },
      subscription_data: {
        metadata: {
          user_id: String(user.id),
          email: user.email
        }
      }
    });
  }

  constructWebhookEvent(rawBody, signature) {
    if (!process.env.STRIPE_WEBHOOK_SECRET) {
      throw new Error("STRIPE_WEBHOOK_SECRET não configurado.");
    }

    return stripe.webhooks.constructEvent(
      rawBody,
      signature,
      process.env.STRIPE_WEBHOOK_SECRET
    );
  }
}

module.exports = new StripeService();