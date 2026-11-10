// Lookbook photos for the login showcase (product images on Shopify's CDN, resized on request)
const img = (u) => `${u}&width=420`

export const LOOKBOOK = [
  { name: "Sapphire", collection: "Luxe Silk", src: img("https://cdn.shopify.com/s/files/1/0695/3936/5032/files/c1_1ad74d4c-95b9-4498-87b2-a011ae3ea35f.jpg?v=1745995108") },
  { name: "Banafsheh", collection: "Aqad", src: img("https://cdn.shopify.com/s/files/1/0695/3936/5032/files/DSCF8913_3c7301e2-559a-46d2-8cdd-20491b9e5650.jpg?v=1744946602") },
  { name: "Dew Blossom", collection: "Serenè", src: img("https://cdn.shopify.com/s/files/1/0695/3936/5032/files/c2_b68ba9bb-11f0-494a-99d3-a4ef57154365.jpg?v=1745996495") },
  { name: "Gulaab Booti", collection: "Marsa'a", src: img("https://cdn.shopify.com/s/files/1/0695/3936/5032/files/DSC6651_5c6c6f46-683e-4095-a97f-e7799e3e2d22.jpg?v=1768252116") },
  { name: "Shab-e-Gul", collection: "Afsaneh – Eid Edit '26", src: img("https://cdn.shopify.com/s/files/1/0695/3936/5032/files/1.webp?v=1771841082") },
  { name: "Zard Chandni", collection: "Afsaneh – Eid Edit '26", src: img("https://cdn.shopify.com/s/files/1/0695/3936/5032/files/36.webp?v=1771840696") },
  { name: "Rang Mahal", collection: "Marsa'a", src: img("https://cdn.shopify.com/s/files/1/0695/3936/5032/files/DSC6068.jpg?v=1768222017") },
  { name: "Ghulab Devi", collection: "Aqad", src: img("https://cdn.shopify.com/s/files/1/0695/3936/5032/files/DSCF9227_6145a438-1f53-4ba0-83fd-794fe8da4fe9.jpg?v=1746045657") },
  { name: "Khaak Roshan", collection: "Marsa'a", src: img("https://cdn.shopify.com/s/files/1/0695/3936/5032/files/DSC6512.jpg?v=1768237240") },
  { name: "Goldenrod", collection: "Luxe Silk", src: img("https://cdn.shopify.com/s/files/1/0695/3936/5032/files/c3_16e38683-3794-4595-8e6a-987293c018e8.jpg?v=1745995964") },
  { name: "Lilac Bloom", collection: "Serenè", src: img("https://cdn.shopify.com/s/files/1/0695/3936/5032/files/c4_a785c31a-28f7-4085-9317-1d5471244c31.jpg?v=1745996655") },
  { name: "Crimson Cascade", collection: "K.Solids", src: img("https://cdn.shopify.com/s/files/1/0695/3936/5032/files/DSC4247.jpg?v=1746261912") },
  { name: "Panther Coral", collection: "SOIE", src: img("https://cdn.shopify.com/s/files/1/0695/3936/5032/files/c6_6bfa387a-2502-4198-8483-6429fbdb7692.jpg?v=1746028931") },
  { name: "Dawat Nama", collection: "Pahli Eid", src: img("https://cdn.shopify.com/s/files/1/0695/3936/5032/files/c4_3526da7c-08af-4b69-b860-a4dcf2e3def4.jpg?v=1745992778") },
  { name: "Giglio d’Oro", collection: "Fiore D'autunno", src: img("https://cdn.shopify.com/s/files/1/0695/3936/5032/files/013A8085.jpg?v=1758471962") },
]
