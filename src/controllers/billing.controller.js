const stripeService = require("../services/stripe.service");
const billingRepository = require("../repositories/billing.repository");

class BillingController {
  async createCheckout(req, res) {
    try {
      const user = req.user;

      if (!user) {
        return res.status(401).json({
          ok: false,
          message: "Usuário não autenticado."
        });
      }

      const session = await stripeService.createCheckoutSession({ user });

      return res.json({
        ok: true,
        data: {
          checkoutUrl: session.url,
          sessionId: session.id
        }
      });
    } catch (error) {
      console.error("Erro ao criar checkout:", error.message);

      return res.status(500).json({
        ok: false,
        message: error.message || "Erro ao criar checkout."
      });
    }
  }

  async status(req, res) {
    try {
      const user = req.user;

      if (!user) {
        return res.status(401).json({
          ok: false,
          message: "Usuário não autenticado."
        });
      }

      const status = await billingRepository.getBillingStatus(user.id);

      return res.json({
        ok: true,
        data: {
          premium: String(status?.plan || "").toUpperCase() === "PREMIUM",
          plan: status?.plan || "FREE",
          subscriptionStatus: status?.subscription_status || "inactive",
          premiumUntil: status?.premium_until || null
        }
      });
    } catch (error) {
      console.error("Erro ao buscar status billing:", error.message);

      return res.status(500).json({
        ok: false,
        message: "Erro ao buscar status do plano."
      });
    }
  }

  async handleWebhook(req, res) {
    let event;

    try {
      const signature = req.headers["stripe-signature"];
      event = stripeService.constructWebhookEvent(req.body, signature);
    } catch (error) {
      console.error("Webhook Stripe inválido:", error.message);

      return res.status(400).json({
        ok: false,
        message: `Webhook inválido: ${error.message}`
      });
    }

    try {
      switch (event.type) {
        case "checkout.session.completed": {
          const session = event.data.object;

          const userId = session.metadata?.user_id;
          const customerId = session.customer;
          const subscriptionId = session.subscription;

          if (userId) {
            await billingRepository.activatePremiumByUserId(userId, {
              customerId,
              subscriptionId,
              subscriptionStatus: "active"
            });
          }

          break;
        }

        case "customer.subscription.updated": {
          const subscription = event.data.object;

          const userId = subscription.metadata?.user_id;
          const customerId = subscription.customer;
          const subscriptionId = subscription.id;
          const status = subscription.status;

          if (userId && ["active", "trialing"].includes(status)) {
            await billingRepository.activatePremiumByUserId(userId, {
              customerId,
              subscriptionId,
              subscriptionStatus: status
            });
          }

          if (["canceled", "unpaid", "past_due", "incomplete_expired"].includes(status)) {
            await billingRepository.downgradeBySubscriptionId(subscriptionId);
          }

          break;
        }

        case "invoice.payment_failed": {
          const invoice = event.data.object;

          if (invoice.subscription) {
            await billingRepository.downgradeBySubscriptionId(invoice.subscription);
          } else if (invoice.customer) {
            await billingRepository.downgradeByCustomerId(invoice.customer);
          }

          break;
        }

        case "customer.subscription.deleted": {
          const subscription = event.data.object;
          await billingRepository.downgradeBySubscriptionId(subscription.id);
          break;
        }

        default:
          break;
      }

      return res.json({
        ok: true,
        received: true
      });
    } catch (error) {
      console.error("Erro ao processar webhook Stripe:", error.message);

      return res.status(500).json({
        ok: false,
        message: "Erro ao processar webhook."
      });
    }
  }
}

module.exports = new BillingController();