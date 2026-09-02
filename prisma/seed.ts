import { PrismaClient } from "@prisma/client";
import bcrypt from "bcryptjs";

const prisma = new PrismaClient();

async function main() {
  // --- Admin user ---
  const adminPasswordHash = await bcrypt.hash("ChangeMe123!", 10);
  await prisma.user.upsert({
    where: { email: "admin@zuriexpress.com" },
    update: {},
    create: {
      name: "Zuri Admin",
      email: "admin@zuriexpress.com",
      passwordHash: adminPasswordHash,
      role: "ADMIN",
    },
  });

  // --- Categories ---
  const categoryNames = [
    { name: "Groceries & Flour", slug: "groceries" },
    { name: "Spices & Seasoning", slug: "spices" },
    { name: "Tea & Coffee", slug: "tea-coffee" },
    { name: "Fabric & Fashion", slug: "fabric-fashion" },
    { name: "Beauty & Personal Care", slug: "beauty" },
  ];

  const categories: Record<string, { id: string }> = {};
  for (const c of categoryNames) {
    categories[c.slug] = await prisma.category.upsert({
      where: { slug: c.slug },
      update: {},
      create: c,
    });
  }

  const products = [
    {
      name: "Jogoo Maize Flour (2kg)",
      slug: "jogoo-maize-flour-2kg",
      description:
        "Classic Kenyan maize meal for ugali, imported and stocked locally in Türkiye.",
      imageUrl: "https://picsum.photos/seed/ze-maize/600/600",
      priceKurus: 18900,
      categorySlug: "groceries",
      fulfillmentType: "STOCKED" as const,
      stock: 24,
    },
    {
      name: "Pishori Rice (5kg)",
      slug: "pishori-rice-5kg",
      description: "Aromatic Kenyan pishori rice, stocked in our Istanbul store.",
      imageUrl: "https://picsum.photos/seed/ze-rice/600/600",
      priceKurus: 42500,
      categorySlug: "groceries",
      fulfillmentType: "STOCKED" as const,
      stock: 15,
    },
    {
      name: "Royco Mchuzi Mix (Pack of 6)",
      slug: "royco-mchuzi-mix-pack-6",
      description: "The seasoning every Kenyan kitchen needs, for stews and curries.",
      imageUrl: "https://picsum.photos/seed/ze-royco/600/600",
      priceKurus: 12000,
      categorySlug: "spices",
      fulfillmentType: "STOCKED" as const,
      stock: 40,
    },
    {
      name: "Pilau Masala (200g)",
      slug: "pilau-masala-200g",
      description: "Coastal Kenyan pilau spice blend, imported from Kenya on request.",
      imageUrl: "https://picsum.photos/seed/ze-pilau/600/600",
      priceKurus: 9500,
      categorySlug: "spices",
      fulfillmentType: "ON_REQUEST" as const,
      leadTimeDays: 18,
    },
    {
      name: "Kenya Purple Tea (500g)",
      slug: "kenya-purple-tea-500g",
      description: "Premium purple tea leaves from the Kenyan highlands.",
      imageUrl: "https://picsum.photos/seed/ze-tea/600/600",
      priceKurus: 27500,
      categorySlug: "tea-coffee",
      fulfillmentType: "STOCKED" as const,
      stock: 18,
    },
    {
      name: "AA Kenyan Coffee Beans (250g)",
      slug: "aa-kenyan-coffee-beans-250g",
      description: "Single-origin AA grade coffee, roasted and imported on request.",
      imageUrl: "https://picsum.photos/seed/ze-coffee/600/600",
      priceKurus: 32000,
      categorySlug: "tea-coffee",
      fulfillmentType: "ON_REQUEST" as const,
      leadTimeDays: 21,
    },
    {
      name: "Kitenge Fabric (6 yards)",
      slug: "kitenge-fabric-6-yards",
      description:
        "Vibrant Kenyan kitenge print fabric, sourced from Nairobi on request. Colors vary.",
      imageUrl: "https://picsum.photos/seed/ze-kitenge/600/600",
      priceKurus: 65000,
      categorySlug: "fabric-fashion",
      fulfillmentType: "ON_REQUEST" as const,
      leadTimeDays: 25,
    },
    {
      name: "Maasai Beaded Bracelet Set",
      slug: "maasai-beaded-bracelet-set",
      description: "Handmade Maasai beadwork bracelets, stocked in Türkiye.",
      imageUrl: "https://picsum.photos/seed/ze-beads/600/600",
      priceKurus: 15000,
      categorySlug: "fabric-fashion",
      fulfillmentType: "STOCKED" as const,
      stock: 12,
    },
    {
      name: "Cocoa Butter Body Cream",
      slug: "cocoa-butter-body-cream",
      description: "Pure Kenyan cocoa butter cream for skin and hair.",
      imageUrl: "https://picsum.photos/seed/ze-cocoa/600/600",
      priceKurus: 14500,
      categorySlug: "beauty",
      fulfillmentType: "STOCKED" as const,
      stock: 2,
    },
    {
      name: "Black Soap (Original)",
      slug: "black-soap-original",
      description: "Traditional African black soap, imported from Kenya on request.",
      imageUrl: "https://picsum.photos/seed/ze-soap/600/600",
      priceKurus: 8000,
      categorySlug: "beauty",
      fulfillmentType: "ON_REQUEST" as const,
      leadTimeDays: 16,
    },
  ];

  for (const p of products) {
    const { categorySlug, ...data } = p;
    await prisma.product.upsert({
      where: { slug: p.slug },
      update: {},
      create: {
        ...data,
        categoryId: categories[categorySlug].id,
      },
    });
  }

  console.log("Seed complete.");
  console.log("Admin login: admin@zuriexpress.com / ChangeMe123!");
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
