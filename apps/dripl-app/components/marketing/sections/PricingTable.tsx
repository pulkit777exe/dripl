"use client";

import { useState } from "react";
import { motion } from "motion/react";
import { Check } from "lucide-react";
import { Button } from "../ui/Button";
import { cn } from "@/lib/utils";

const PLANS = [
  {
    name: "Starter",
    price: { monthly: "0", yearly: "0" },
    desc: "For individuals exploring the canvas.",
    features: ["Unlimited Canvas", "3 Social Accounts", "7-day History"],
    cta: "Start for free",
    variant: "outline",
  },
  {
    name: "Agency",
    price: { monthly: "49", yearly: "39" },
    desc: "For content teams scaling up.",
    features: [
      "Everything in Starter",
      "Unlimited Accounts",
      "Interactive Review flows",
      "Team Roles & Permissions",
    ],
    cta: "Get Started",
    variant: "primary",
    highlight: true,
  },
  {
    name: "Enterprise",
    price: { monthly: "Custom", yearly: "Custom" },
    desc: "For large organizations.",
    features: ["SSO & SAML", "Dedicated Success Manager", "Custom SLA"],
    cta: "Contact Sales",
    variant: "outline",
  },
];

export function PricingTable() {
  const [billing, setBilling] = useState<"monthly" | "yearly">("yearly");

  return (
    <section className="container mx-auto px-4 py-32" id="pricing">
      <div className="mb-16 text-center">
        <h2 className="mb-4 text-4xl font-medium tracking-tight text-deep-charcoal">
          Simple, transparent pricing.
        </h2>
        <p className="mb-10 text-lg text-foreground/60">
          No hidden fees. Cancel anytime.
        </p>

        <div className="inline-flex rounded-full border border-structure-grey bg-vapor-grey p-1">
          {(["monthly", "yearly"] as const).map((cycle) => (
            <button
              key={cycle}
              onClick={() => setBilling(cycle)}
              className={cn(
                "relative rounded-full px-6 py-2 text-sm font-medium transition-colors",
                billing === cycle
                  ? "text-deep-charcoal"
                  : "text-foreground/50 hover:text-foreground",
              )}
            >
              {billing === cycle && (
                <motion.div
                  layoutId="billing-pill"
                  className="absolute inset-0 z-0 rounded-full bg-white shadow-attio-sm"
                  transition={{ type: "spring", bounce: 0.2, duration: 0.6 }}
                />
              )}
              <span className="relative z-10 capitalize">
                {cycle}
                {cycle === "yearly" && " (-20%)"}
              </span>
            </button>
          ))}
        </div>
      </div>

      <div className="grid grid-cols-1 gap-8 lg:grid-cols-3">
        {PLANS.map((plan) => (
          <motion.div
            key={plan.name}
            initial={{ opacity: 0, y: 20 }}
            whileInView={{ opacity: 1, y: 0 }}
            viewport={{ once: true }}
            className={cn(
              "relative flex flex-col rounded-3xl border border-structure-grey bg-white p-8 transition-all hover:shadow-attio-lg",
              plan.highlight &&
                "lg:-mt-4 lg:mb-4 lg:shadow-attio-md lg:border-deep-charcoal/10",
            )}
          >
            {plan.highlight && (
              <div className="absolute -top-4 left-1/2 -translate-x-1/2 rounded-full bg-deep-charcoal px-4 py-1 text-xs font-medium text-white shadow-attio-sm">
                Most Popular
              </div>
            )}

            <h3 className="text-xl font-medium text-deep-charcoal">
              {plan.name}
            </h3>
            <p className="mt-2 text-sm text-foreground/60">{plan.desc}</p>

            <div className="my-8">
              <span className="text-5xl font-light tracking-tight text-deep-charcoal">
                {plan.price[billing] === "Custom"
                  ? "Custom"
                  : `$${plan.price[billing]}`}
              </span>
              {plan.price[billing] !== "Custom" && (
                <span className="text-foreground/40">/mo</span>
              )}
            </div>

            <ul className="mb-8 flex-1 space-y-4">
              {plan.features.map((feature) => (
                <li
                  key={feature}
                  className="flex items-center gap-3 text-sm text-foreground/80"
                >
                  <Check className="h-4 w-4 text-deep-charcoal" />
                  {feature}
                </li>
              ))}
            </ul>

            <Button variant={plan.variant as any} className="w-full">
              {plan.cta}
            </Button>
          </motion.div>
        ))}
      </div>
    </section>
  );
}
