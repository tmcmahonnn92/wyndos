import { PrismaClient } from "../src/generated/prisma/client";
import { PrismaBetterSqlite3 } from "@prisma/adapter-better-sqlite3";
import path from "path";

const adapter = new PrismaBetterSqlite3({
  url: path.resolve(process.cwd(), "dev.db"),
});
const prisma = new PrismaClient({ adapter } as any);

/** UTC midnight – avoids timezone drift when storing dates */
function utcDay(d: Date): Date {
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
}

// ── Real customer data from "Window Cleaning Work.xlsx" ──────────────────────
// All work located near Worksop, Nottinghamshire, UK

const LANGOLD_CUSTOMERS = [
  { name: "68 Riddel, Langold",           address: "68 Riddel, Langold, S81",                   price: 20, frequencyWeeks: 4 },
  { name: "15 Markham, Langold",          address: "15 Markham Road, Langold, S81",              price: 15, frequencyWeeks: 4 },
  { name: "6 Cross Street, Langold",      address: "6 Cross Street, Langold, S81",               price: 11, frequencyWeeks: 4 },
  { name: "31 Church St, Langold",        address: "31 Church Street, Langold, S81",             price: 14, frequencyWeeks: 4 },
  { name: "33 Church St, Langold",        address: "33 Church Street, Langold, S81",             price: 12, frequencyWeeks: 4 },
  { name: "12 Church St, Langold",        address: "12 Church Street, Langold, S81",             price: 10, frequencyWeeks: 4 },
  { name: "7 Main St, Oldcotes",          address: "7 Main Street, Oldcotes, S81",               price: 17, frequencyWeeks: 4 },
  { name: "Roche House, Oldcotes",        address: "Roche House, Oldcotes, S81",                 price: 20, frequencyWeeks: 8 },
  { name: "Gildingwells Farm",            address: "Gildingwells Farm, Gildingwells, S81",       price: 40, frequencyWeeks: 4 },
  { name: "86 Lincoln Rd, Tuxford",       address: "86 Lincoln Road, Tuxford, NG22",             price: 14, frequencyWeeks: 4 },
  { name: "14b Gilbert Ave, Tuxford",     address: "14b Gilbert Avenue, Tuxford, NG22",          price: 10, frequencyWeeks: 4 },
  { name: "15 Machin, Tuxford",           address: "15 Machin Road, Tuxford, NG22",              price: 15, frequencyWeeks: 4 },
  { name: "17 Machin, Tuxford",           address: "17 Machin Road, Tuxford, NG22",              price: 12, frequencyWeeks: 4 },
  { name: "19 Machin, Tuxford",           address: "19 Machin Road, Tuxford, NG22",              price: 10, frequencyWeeks: 4 },
  { name: "25 Machin, Tuxford",           address: "25 Machin Road, Tuxford, NG22",              price: 10, frequencyWeeks: 4 },
  { name: "Kennels, Tuxford",             address: "Kennels, Tuxford, NG22",                     price: 20, frequencyWeeks: 4 },
  { name: "Salon, Tuxford",               address: "Salon, Tuxford, NG22",                       price:  7, frequencyWeeks: 4 },
  { name: "Goosemore House, Tuxford",     address: "Goosemore House, Tuxford, NG22",             price: 40, frequencyWeeks: 4 },
  { name: "Church View, Tuxford",         address: "Church View, Tuxford, NG22",                 price: 12, frequencyWeeks: 4 },
  { name: "Retford Paving, Retford",      address: "Retford Paving, Retford, DN22",              price: 15, frequencyWeeks: 4 },
  { name: "18 Lowfields, Retford",        address: "18 Lowfields, Retford, DN22",                price: 15, frequencyWeeks: 4 },
  { name: "Old Vicarage, Blyth",          address: "Old Vicarage, Blyth, S81",                   price: 45, frequencyWeeks: 4 },
  { name: "Botany Bay Farm",              address: "Botany Bay Farm, Ranskill, DN22",            price: 20, frequencyWeeks: 4 },
  { name: "White Cottage, Budby",         address: "White Cottage, Budby, NG22",                 price: 30, frequencyWeeks: 8 },
];

const MODEL_WAY_CUSTOMERS = [
  { name: "2 Model Lane, Creswell",          address: "2 Model Lane, Creswell, S80",            price:  8, frequencyWeeks: 4 },
  { name: "3 Model Lane, Creswell",          address: "3 Model Lane, Creswell, S80",            price: 10, frequencyWeeks: 4 },
  { name: "4 Model Lane, Creswell",          address: "4 Model Lane, Creswell, S80",            price:  8, frequencyWeeks: 4 },
  { name: "10 Model Lane, Creswell",         address: "10 Model Lane, Creswell, S80",           price: 12, frequencyWeeks: 4 },
  { name: "11 Model Lane, Creswell",         address: "11 Model Lane, Creswell, S80",           price:  8, frequencyWeeks: 4 },
  { name: "16 Model Lane, Creswell",         address: "16 Model Lane, Creswell, S80",           price: 12, frequencyWeeks: 4 },
  { name: "18 Model Lane, Creswell",         address: "18 Model Lane, Creswell, S80",           price:  8, frequencyWeeks: 4 },
  { name: "17 Model Lane, Creswell",         address: "17 Model Lane, Creswell, S80",           price: 10, frequencyWeeks: 4 },
  { name: "31 Model Lane, Creswell",         address: "31 Model Lane, Creswell, S80",           price: 17, frequencyWeeks: 4 },
  { name: "33 Model Lane, Creswell",         address: "33 Model Lane, Creswell, S80",           price:  8, frequencyWeeks: 4 },
  { name: "8 Model View, Creswell",          address: "8 Model View, Creswell, S80",            price:  8, frequencyWeeks: 4 },
  { name: "10 Model View, Creswell",         address: "10 Model View, Creswell, S80",           price:  8, frequencyWeeks: 4 },
  { name: "14 Model View, Creswell",         address: "14 Model View, Creswell, S80",           price:  8, frequencyWeeks: 4 },
  { name: "10 Fox Street, Creswell",         address: "10 Fox Street, Creswell, S80",           price:  8, frequencyWeeks: 4 },
  { name: "27 Fox Street, Creswell",         address: "27 Fox Street, Creswell, S80",           price:  8, frequencyWeeks: 4 },
  { name: "44 Fox Street, Creswell",         address: "44 Fox Street, Creswell, S80",           price:  8, frequencyWeeks: 4 },
  { name: "17 Fox Street, Creswell",         address: "17 Fox Street, Creswell, S80",           price: 12, frequencyWeeks: 4 },
  { name: "14 Fox Street, Creswell",         address: "14 Fox Street, Creswell, S80",           price: 12, frequencyWeeks: 4 },
  { name: "34 Fox Street, Creswell",         address: "34 Fox Street, Creswell, S80",           price: 12, frequencyWeeks: 4 },
  { name: "1 Fox Lane, Creswell",            address: "1 Fox Lane, Creswell, S80",              price:  8, frequencyWeeks: 4 },
  { name: "3 Fox Lane, Creswell",            address: "3 Fox Lane, Creswell, S80",              price:  8, frequencyWeeks: 4 },
  { name: "2 Colliery Street, Creswell",     address: "2 Colliery Street, Creswell, S80",       price: 10, frequencyWeeks: 4 },
  { name: "6 Colliery Street, Creswell",     address: "6 Colliery Street, Creswell, S80",       price: 12, frequencyWeeks: 4 },
  { name: "12 Colliery Street, Creswell",    address: "12 Colliery Street, Creswell, S80",      price: 10, frequencyWeeks: 4 },
  { name: "26 Colliery Street, Creswell",    address: "26 Colliery Street, Creswell, S80",      price: 12, frequencyWeeks: 4 },
  { name: "2 Colliery Way, Creswell",        address: "2 Colliery Way, Creswell, S80",          price: 12, frequencyWeeks: 4 },
  { name: "4 Colliery Way, Creswell",        address: "4 Colliery Way, Creswell, S80",          price: 12, frequencyWeeks: 4 },
  { name: "15 Elmton Way, Creswell",         address: "15 Elmton Way, Creswell, S80",           price: 12, frequencyWeeks: 8 },
  { name: "7 Elmton Way, Creswell",          address: "7 Elmton Way, Creswell, S80",            price: 12, frequencyWeeks: 4 },
  { name: "4 Elmton Way, Creswell",          address: "4 Elmton Way, Creswell, S80",            price: 12, frequencyWeeks: 8 },
];

const ROGERS_PORTLAND_CUSTOMERS = [
  { name: "1 Rogers Ave, Worksop",        address: "1 Rogers Avenue, Worksop, S80",    price: 12, frequencyWeeks: 4 },
  { name: "3 Rogers Ave, Worksop",        address: "3 Rogers Avenue, Worksop, S80",    price: 12, frequencyWeeks: 4 },
  { name: "5 Rogers Ave, Worksop",        address: "5 Rogers Avenue, Worksop, S80",    price:  8, frequencyWeeks: 4 },
  { name: "9 Rogers Ave, Worksop",        address: "9 Rogers Avenue, Worksop, S80",    price:  5, frequencyWeeks: 4 },
  { name: "11 Rogers Ave, Worksop",       address: "11 Rogers Avenue, Worksop, S80",   price: 10, frequencyWeeks: 4 },
  { name: "13 Rogers Ave, Worksop",       address: "13 Rogers Avenue, Worksop, S80",   price: 10, frequencyWeeks: 4 },
  { name: "15 Rogers Ave, Worksop",       address: "15 Rogers Avenue, Worksop, S80",   price: 10, frequencyWeeks: 4 },
  { name: "17 Rogers Ave, Worksop",       address: "17 Rogers Avenue, Worksop, S80",   price: 10, frequencyWeeks: 4 },
  { name: "19 Rogers Ave, Worksop",       address: "19 Rogers Avenue, Worksop, S80",   price: 10, frequencyWeeks: 4 },
  { name: "21 Rogers Ave, Worksop",       address: "21 Rogers Avenue, Worksop, S80",   price: 12, frequencyWeeks: 4 },
  { name: "25 Rogers Ave, Worksop",       address: "25 Rogers Avenue, Worksop, S80",   price: 10, frequencyWeeks: 4 },
  { name: "29 Rogers Ave, Worksop",       address: "29 Rogers Avenue, Worksop, S80",   price: 10, frequencyWeeks: 4 },
  { name: "31 Rogers Ave, Worksop",       address: "31 Rogers Avenue, Worksop, S80",   price:  5, frequencyWeeks: 4 },
  { name: "33 Rogers Ave, Worksop",       address: "33 Rogers Avenue, Worksop, S80",   price:  5, frequencyWeeks: 4 },
  { name: "37 Rogers Ave, Worksop",       address: "37 Rogers Avenue, Worksop, S80",   price: 10, frequencyWeeks: 4 },
  { name: "39 Rogers Ave, Worksop",       address: "39 Rogers Avenue, Worksop, S80",   price:  7, frequencyWeeks: 4 },
  { name: "2 Rogers Ave, Worksop",        address: "2 Rogers Avenue, Worksop, S80",    price: 12, frequencyWeeks: 4 },
  { name: "6 Rogers Ave, Worksop",        address: "6 Rogers Avenue, Worksop, S80",    price: 12, frequencyWeeks: 4 },
  { name: "14 Rogers Ave, Worksop",       address: "14 Rogers Avenue, Worksop, S80",   price: 10, frequencyWeeks: 4 },
  { name: "18 Rogers Ave, Worksop",       address: "18 Rogers Avenue, Worksop, S80",   price: 10, frequencyWeeks: 4 },
  { name: "20 Rogers Ave, Worksop",       address: "20 Rogers Avenue, Worksop, S80",   price: 10, frequencyWeeks: 4 },
  { name: "24 Rogers Ave, Worksop",       address: "24 Rogers Avenue, Worksop, S80",   price: 12, frequencyWeeks: 4 },
  { name: "26 Rogers Ave, Worksop",       address: "26 Rogers Avenue, Worksop, S80",   price: 10, frequencyWeeks: 4 },
  { name: "28 Rogers Ave, Worksop",       address: "28 Rogers Avenue, Worksop, S80",   price: 10, frequencyWeeks: 4 },
  { name: "30 Rogers Ave, Worksop",       address: "30 Rogers Avenue, Worksop, S80",   price: 10, frequencyWeeks: 4 },
  { name: "32 Rogers Ave, Worksop",       address: "32 Rogers Avenue, Worksop, S80",   price: 10, frequencyWeeks: 4 },
  { name: "34 Rogers Ave, Worksop",       address: "34 Rogers Avenue, Worksop, S80",   price: 12, frequencyWeeks: 4 },
  { name: "42a Rogers Ave, Worksop",      address: "42a Rogers Avenue, Worksop, S80",  price:  5, frequencyWeeks: 4 },
  { name: "40 Portland Ave, Worksop",     address: "40 Portland Avenue, Worksop, S80", price: 10, frequencyWeeks: 4 },
  { name: "48 Portland Ave, Worksop",     address: "48 Portland Avenue, Worksop, S80", price: 10, frequencyWeeks: 4 },
  { name: "50 Portland Ave, Worksop",     address: "50 Portland Avenue, Worksop, S80", price: 10, frequencyWeeks: 4 },
  { name: "54 Portland Ave, Worksop",     address: "54 Portland Avenue, Worksop, S80", price:  7, frequencyWeeks: 4 },
  { name: "66 Portland Ave, Worksop",     address: "66 Portland Avenue, Worksop, S80", price: 10, frequencyWeeks: 8 },
  { name: "70 Portland Ave, Worksop",     address: "70 Portland Avenue, Worksop, S80", price: 10, frequencyWeeks: 4 },
  { name: "74 Portland Ave, Worksop",     address: "74 Portland Avenue, Worksop, S80", price: 10, frequencyWeeks: 4 },
  { name: "76 Portland Ave, Worksop",     address: "76 Portland Avenue, Worksop, S80", price: 12, frequencyWeeks: 4 },
  { name: "82 Portland Ave, Worksop",     address: "82 Portland Avenue, Worksop, S80", price: 10, frequencyWeeks: 4 },
  { name: "84 Portland Ave, Worksop",     address: "84 Portland Avenue, Worksop, S80", price: 10, frequencyWeeks: 4 },
  { name: "39 Portland Ave, Worksop",     address: "39 Portland Avenue, Worksop, S80", price: 10, frequencyWeeks: 4 },
  { name: "41 Portland Ave, Worksop",     address: "41 Portland Avenue, Worksop, S80", price: 10, frequencyWeeks: 4 },
  { name: "55 Portland Ave, Worksop",     address: "55 Portland Avenue, Worksop, S80", price: 10, frequencyWeeks: 4 },
  { name: "57 Portland Ave, Worksop",     address: "57 Portland Avenue, Worksop, S80", price: 12, frequencyWeeks: 4 },
  { name: "59 Portland Ave, Worksop",     address: "59 Portland Avenue, Worksop, S80", price: 10, frequencyWeeks: 4 },
  { name: "61 Portland Ave, Worksop",     address: "61 Portland Avenue, Worksop, S80", price: 10, frequencyWeeks: 4 },
  { name: "65 Portland Ave, Worksop",     address: "65 Portland Avenue, Worksop, S80", price: 10, frequencyWeeks: 4 },
];

const CRESWELL_CUSTOMERS = [
  { name: "5 Sherwood Ave, Creswell",     address: "5 Sherwood Avenue, Creswell, S80",  price:  5, frequencyWeeks: 4 },
  { name: "7 Sherwood Ave, Creswell",     address: "7 Sherwood Avenue, Creswell, S80",  price:  7, frequencyWeeks: 4 },
  { name: "15 Sherwood Ave, Creswell",    address: "15 Sherwood Avenue, Creswell, S80", price: 10, frequencyWeeks: 4 },
  { name: "2 Sherwood Ave, Creswell",     address: "2 Sherwood Avenue, Creswell, S80",  price: 10, frequencyWeeks: 8 },
  { name: "6 Sherwood Ave, Creswell",     address: "6 Sherwood Avenue, Creswell, S80",  price: 10, frequencyWeeks: 4 },
  { name: "16 Sherwood Ave, Creswell",    address: "16 Sherwood Avenue, Creswell, S80", price: 10, frequencyWeeks: 4 },
  { name: "28 Sherwood Ave, Creswell",    address: "28 Sherwood Avenue, Creswell, S80", price: 11, frequencyWeeks: 4 },
  { name: "30 Sherwood Ave, Creswell",    address: "30 Sherwood Avenue, Creswell, S80", price: 10, frequencyWeeks: 4 },
  { name: "34 Sherwood Ave, Creswell",    address: "34 Sherwood Avenue, Creswell, S80", price:  7, frequencyWeeks: 4 },
  { name: "36 Sherwood Ave, Creswell",    address: "36 Sherwood Avenue, Creswell, S80", price: 12, frequencyWeeks: 4 },
  { name: "4 West St, Creswell",          address: "4 West Street, Creswell, S80",       price: 10, frequencyWeeks: 4 },
  { name: "6 West St, Creswell",          address: "6 West Street, Creswell, S80",       price:  5, frequencyWeeks: 4 },
  { name: "8 West St, Creswell",          address: "8 West Street, Creswell, S80",       price: 10, frequencyWeeks: 4 },
  { name: "30 West St, Creswell",         address: "30 West Street, Creswell, S80",      price: 10, frequencyWeeks: 4 },
  { name: "62 West St, Creswell",         address: "62 West Street, Creswell, S80",      price: 10, frequencyWeeks: 4 },
  { name: "64 West St, Creswell",         address: "64 West Street, Creswell, S80",      price:  7, frequencyWeeks: 4 },
  { name: "29 West St, Creswell",         address: "29 West Street, Creswell, S80",      price: 12, frequencyWeeks: 4 },
  { name: "31 West St, Creswell",         address: "31 West Street, Creswell, S80",      price: 12, frequencyWeeks: 4 },
  { name: "37 West St, Creswell",         address: "37 West Street, Creswell, S80",      price: 10, frequencyWeeks: 4 },
  { name: "39 West St, Creswell",         address: "39 West Street, Creswell, S80",      price: 10, frequencyWeeks: 4 },
  { name: "1 Eyre St, Creswell",          address: "1 Eyre Street, Creswell, S80",       price: 10, frequencyWeeks: 4 },
  { name: "11 Eyre St, Creswell",         address: "11 Eyre Street, Creswell, S80",      price: 10, frequencyWeeks: 4 },
  { name: "21 Eyre St, Creswell",         address: "21 Eyre Street, Creswell, S80",      price: 10, frequencyWeeks: 4 },
  { name: "10 Eyre St, Creswell",         address: "10 Eyre Street, Creswell, S80",      price: 10, frequencyWeeks: 4 },
  { name: "6 Tennyson Ave, Creswell",     address: "6 Tennyson Avenue, Creswell, S80",  price: 10, frequencyWeeks: 4 },
  { name: "10 Tennyson Ave, Creswell",    address: "10 Tennyson Avenue, Creswell, S80", price: 10, frequencyWeeks: 4 },
  { name: "64 Skinner St, Creswell",      address: "64 Skinner Street, Creswell, S80",  price: 35, frequencyWeeks: 4 },
  { name: "70 Skinner St, Creswell",      address: "70 Skinner Street, Creswell, S80",  price: 12, frequencyWeeks: 4 },
  { name: "67 Skinner St, Creswell",      address: "67 Skinner Street, Creswell, S80",  price: 12, frequencyWeeks: 4 },
  { name: "77 Skinner St, Creswell",      address: "77 Skinner Street, Creswell, S80",  price: 10, frequencyWeeks: 4 },
];

const ELMTON_CUSTOMERS = [
  { name: "4 Cavendish, Whitwell",              address: "4 Cavendish Road, Whitwell, S80",              price: 15, frequencyWeeks: 4 },
  { name: "11 Devonshire Drive, Creswell",      address: "11 Devonshire Drive, Creswell, S80",           price: 10, frequencyWeeks: 4 },
  { name: "10 Devonshire Drive, Creswell",      address: "10 Devonshire Drive, Creswell, S80",           price:  8, frequencyWeeks: 4 },
  { name: "8 Devonshire Drive, Creswell",       address: "8 Devonshire Drive, Creswell, S80",            price: 10, frequencyWeeks: 4 },
  { name: "10 Beeley Close, Creswell",          address: "10 Beeley Close, Creswell, S80",               price: 13, frequencyWeeks: 4 },
  { name: "21 Elmton Rd, Creswell",             address: "21 Elmton Road, Creswell, S80",                price: 10, frequencyWeeks: 4 },
  { name: "23 Elmton Rd, Creswell",             address: "23 Elmton Road, Creswell, S80",                price: 10, frequencyWeeks: 4 },
  { name: "65a Elmton Rd, Creswell",            address: "65a Elmton Road, Creswell, S80",               price: 12, frequencyWeeks: 4 },
  { name: "162 Elmton Rd, Creswell",            address: "162 Elmton Road, Creswell, S80",               price: 10, frequencyWeeks: 4 },
  { name: "166 Elmton Rd, Creswell",            address: "166 Elmton Road, Creswell, S80",               price: 10, frequencyWeeks: 4 },
  { name: "168 Elmton Rd, Creswell",            address: "168 Elmton Road, Creswell, S80",               price: 12, frequencyWeeks: 8 },
  { name: "170 Elmton Rd, Creswell",            address: "170 Elmton Road, Creswell, S80",               price: 10, frequencyWeeks: 4 },
  { name: "176 Elmton Rd, Creswell",            address: "176 Elmton Road, Creswell, S80",               price: 12, frequencyWeeks: 4 },
  { name: "178 Elmton Rd, Creswell",            address: "178 Elmton Road, Creswell, S80",               price: 12, frequencyWeeks: 4 },
  { name: "186 Elmton Rd, Creswell",            address: "186 Elmton Road, Creswell, S80",               price: 10, frequencyWeeks: 4 },
  { name: "194 Elmton Rd, Creswell",            address: "194 Elmton Road, Creswell, S80",               price: 10, frequencyWeeks: 4 },
  { name: "198 Elmton Rd, Creswell",            address: "198 Elmton Road, Creswell, S80",               price: 10, frequencyWeeks: 4 },
  { name: "224 Elmton Rd, Creswell",            address: "224 Elmton Road, Creswell, S80",               price: 10, frequencyWeeks: 4 },
  { name: "234 Elmton Rd, Creswell",            address: "234 Elmton Road, Creswell, S80",               price: 10, frequencyWeeks: 4 },
  { name: "240 Elmton Rd, Creswell",            address: "240 Elmton Road, Creswell, S80",               price: 10, frequencyWeeks: 4 },
  { name: "Woodburn Bungalow, Elmton Rd",       address: "Woodburn Bungalow, Elmton Road, Creswell, S80",price: 12, frequencyWeeks: 4 },
  { name: "Zetland House, Elmton Rd",           address: "Zetland House, Elmton Road, Creswell, S80",    price: 15, frequencyWeeks: 4 },
  { name: "246 Elmton Rd, Creswell",            address: "246 Elmton Road, Creswell, S80",               price: 12, frequencyWeeks: 4 },
  { name: "250 Elmton Rd, Creswell",            address: "250 Elmton Road, Creswell, S80",               price: 12, frequencyWeeks: 4 },
  { name: "254 Elmton Rd, Creswell",            address: "254 Elmton Road, Creswell, S80",               price: 12, frequencyWeeks: 4 },
  { name: "256 Elmton Rd, Creswell",            address: "256 Elmton Road, Creswell, S80",               price: 10, frequencyWeeks: 4 },
  { name: "282 Elmton Rd, Creswell",            address: "282 Elmton Road, Creswell, S80",               price: 10, frequencyWeeks: 4 },
  { name: "6 Elmton Close, Creswell",           address: "6 Elmton Close, Creswell, S80",                price: 14, frequencyWeeks: 4 },
  { name: "8 Elmton Close, Creswell",           address: "8 Elmton Close, Creswell, S80",                price: 12, frequencyWeeks: 4 },
  { name: "Bungalow, Elmton Close",             address: "Bungalow, Elmton Close, Creswell, S80",        price: 15, frequencyWeeks: 8 },
  { name: "24 Elmton Close, Creswell",          address: "24 Elmton Close, Creswell, S80",               price: 10, frequencyWeeks: 4 },
  { name: "28 Elmton Close, Creswell",          address: "28 Elmton Close, Creswell, S80",               price:  7, frequencyWeeks: 4 },
  { name: "30 Elmton Close, Creswell",          address: "30 Elmton Close, Creswell, S80",               price:  7, frequencyWeeks: 4 },
  { name: "32 Elmton Close, Creswell",          address: "32 Elmton Close, Creswell, S80",               price:  7, frequencyWeeks: 4 },
  { name: "21 Elmton Close, Creswell",          address: "21 Elmton Close, Creswell, S80",               price:  7, frequencyWeeks: 4 },
  { name: "2 Bulivant Ave, Creswell",           address: "2 Bulivant Avenue, Creswell, S80",             price: 12, frequencyWeeks: 4 },
  { name: "Frithwood Farm Cottage",             address: "Frithwood Farm Cottage, Elmton Road, S80",     price: 30, frequencyWeeks: 4 },
  { name: "Frithwood House",                    address: "Frithwood House, Elmton Road, S80",            price: 30, frequencyWeeks: 4 },
  { name: "Stables, Frithwood",                 address: "Stables, Frithwood, Elmton Road, S80",         price: 15, frequencyWeeks: 4 },
  { name: "Mistal Barn, Frithwood",             address: "Mistal Barn, Frithwood, S80",                  price: 20, frequencyWeeks: 4 },
];

const BOLSOVER_CUSTOMERS = [
  { name: "1 Highfield, Bolsover",       address: "1 Highfield Road, Bolsover, S44",    price: 10, frequencyWeeks: 4 },
  { name: "3 Highfield, Bolsover",       address: "3 Highfield Road, Bolsover, S44",    price: 15, frequencyWeeks: 4 },
  { name: "5 Highfield, Bolsover",       address: "5 Highfield Road, Bolsover, S44",    price: 12, frequencyWeeks: 4 },
  { name: "7 Highfield, Bolsover",       address: "7 Highfield Road, Bolsover, S44",    price: 17, frequencyWeeks: 4 },
  { name: "9 Highfield, Bolsover",       address: "9 Highfield Road, Bolsover, S44",    price: 15, frequencyWeeks: 4 },
  { name: "11 Highfield, Bolsover",      address: "11 Highfield Road, Bolsover, S44",   price: 12, frequencyWeeks: 4 },
  { name: "15 Highfield, Bolsover",      address: "15 Highfield Road, Bolsover, S44",   price:  5, frequencyWeeks: 4 },
  { name: "17 Highfield, Bolsover",      address: "17 Highfield Road, Bolsover, S44",   price:  5, frequencyWeeks: 4 },
  { name: "6 Highfield, Bolsover",       address: "6 Highfield Road, Bolsover, S44",    price: 14, frequencyWeeks: 4 },
  { name: "8 Highfield, Bolsover",       address: "8 Highfield Road, Bolsover, S44",    price: 15, frequencyWeeks: 4 },
  { name: "14 Brookfield, Bolsover",     address: "14 Brookfield, Bolsover, S44",       price: 12, frequencyWeeks: 4 },
  { name: "10 Brookfield, Bolsover",     address: "10 Brookfield, Bolsover, S44",       price: 10, frequencyWeeks: 4 },
  { name: "11a Searson, Bolsover",       address: "11a Searson Avenue, Bolsover, S44",  price: 12, frequencyWeeks: 4 },
  { name: "8 Searson, Bolsover",         address: "8 Searson Avenue, Bolsover, S44",    price:  8, frequencyWeeks: 4 },
  { name: "63 Houfton, Bolsover",        address: "63 Houfton Road, Bolsover, S44",     price: 14, frequencyWeeks: 4 },
  { name: "34 Northfields, Bolsover",    address: "34 Northfields, Bolsover, S44",      price:  8, frequencyWeeks: 4 },
  { name: "38 Northfields, Bolsover",    address: "38 Northfields, Bolsover, S44",      price: 12, frequencyWeeks: 4 },
  { name: "87 High Street, Clowne",      address: "87 High Street, Clowne, S43",        price: 10, frequencyWeeks: 4 },
  { name: "85 High Street, Clowne",      address: "85 High Street, Clowne, S43",        price: 10, frequencyWeeks: 4 },
  { name: "Pink Houses, Clowne",         address: "Pink Houses, Clowne, S43",           price: 40, frequencyWeeks: 4 },
  { name: "1 Old Hall, Langwith",        address: "1 Old Hall Road, Langwith, NG20",    price: 20, frequencyWeeks: 4 },
  { name: "2 Old Hall, Langwith",        address: "2 Old Hall Road, Langwith, NG20",    price: 15, frequencyWeeks: 4 },
  { name: "3 Old Hall, Langwith",        address: "3 Old Hall Road, Langwith, NG20",    price: 20, frequencyWeeks: 4 },
  { name: "Big House, Langwith",         address: "Big House, Langwith, NG20",          price: 45, frequencyWeeks: 4 },
  { name: "Mark & Rachel, Langwith",     address: "Mark & Rachel, Langwith, NG20",      price: 15, frequencyWeeks: 4 },
];

const EDWINSTOWE_CUSTOMERS = [
  { name: "25 Beardsley Rd, Edwinstowe",   address: "25 Beardsley Road, Edwinstowe, NG21",   price: 10, frequencyWeeks: 12 },
  { name: "10 Beardsley Rd, Edwinstowe",   address: "10 Beardsley Road, Edwinstowe, NG21",   price:  7, frequencyWeeks: 4  },
  { name: "32 First Ave, Edwinstowe",      address: "32 First Avenue, Edwinstowe, NG21",     price: 10, frequencyWeeks: 4  },
  { name: "49 First Ave, Edwinstowe",      address: "49 First Avenue, Edwinstowe, NG21",     price: 17, frequencyWeeks: 4  },
  { name: "92 Fourth Ave, Edwinstowe",     address: "92 Fourth Avenue, Edwinstowe, NG21",    price: 10, frequencyWeeks: 4  },
  { name: "56 Fifth Ave, Edwinstowe",      address: "56 Fifth Avenue, Edwinstowe, NG21",     price: 13, frequencyWeeks: 4  },
  { name: "54 Fifth Ave, Edwinstowe",      address: "54 Fifth Avenue, Edwinstowe, NG21",     price: 10, frequencyWeeks: 4  },
  { name: "Andy Knowles, Edwinstowe",      address: "Andy Knowles, Edwinstowe, NG21",        price: 30, frequencyWeeks: 4  },
  { name: "The Kennels, Perlthorpe",       address: "The Kennels, Perlthorpe, NG22",         price: 25, frequencyWeeks: 8  },
  { name: "10 Jackson Hill, Perlthorpe",   address: "10 Jackson Hill, Perlthorpe, NG22",     price:  5, frequencyWeeks: 4  },
  { name: "8 Jackson Hill, Perlthorpe",    address: "8 Jackson Hill, Perlthorpe, NG22",      price: 15, frequencyWeeks: 4  },
  { name: "3 Jackson Hill, Perlthorpe",    address: "3 Jackson Hill, Perlthorpe, NG22",      price: 20, frequencyWeeks: 4  },
  { name: "1 Whitmor Cottage, Perlthorpe", address: "1 Whitmor Cottage, Perlthorpe, NG22",   price: 15, frequencyWeeks: 8  },
  { name: "2 Whitmor Cottage, Perlthorpe", address: "2 Whitmor Cottage, Perlthorpe, NG22",   price:  5, frequencyWeeks: 4  },
  { name: "Bothamsall Bungalow",           address: "Bothamsall Bungalow, Bothamsall, NG22", price: 15, frequencyWeeks: 4  },
  { name: "Middle House, Bothamsall",      address: "Middle House, Bothamsall, NG22",        price: 25, frequencyWeeks: 8  },
];

const WELBECK_CUSTOMERS = [
  { name: "Meadow Lodge, Welbeck",          address: "Meadow Lodge, Welbeck, S80",             price: 25, frequencyWeeks: 8 },
  { name: "4 Lake View, Welbeck",           address: "4 Lake View, Welbeck, S80",              price: 12, frequencyWeeks: 4 },
  { name: "2 Lake View, Welbeck",           address: "2 Lake View, Welbeck, S80",              price: 12, frequencyWeeks: 4 },
  { name: "1 Lake View, Welbeck",           address: "1 Lake View, Welbeck, S80",              price: 12, frequencyWeeks: 4 },
  { name: "Meadowside Bungalow, Welbeck",   address: "Meadowside Bungalow, Welbeck, S80",      price: 15, frequencyWeeks: 4 },
  { name: "Mallards, Welbeck",              address: "Mallards, Welbeck, S80",                 price: 18, frequencyWeeks: 4 },
  { name: "Mr Brightman, Welbeck",          address: "Mr Brightman, Welbeck, S80",             price: 19, frequencyWeeks: 4 },
  { name: "Walpole, Welbeck",               address: "Walpole, Welbeck, S80",                  price: 25, frequencyWeeks: 4 },
  { name: "Tea Rooms, Welbeck",             address: "Tea Rooms, Welbeck, S80",                price: 25, frequencyWeeks: 4 },
  { name: "Bentink Lodge, Welbeck",         address: "Bentink Lodge, Welbeck, S80",            price: 17, frequencyWeeks: 4 },
  { name: "4 Lady Margaret Cres, Welbeck",  address: "4 Lady Margaret Crescent, Welbeck, S80", price: 10, frequencyWeeks: 4 },
  { name: "3 Lady Margaret Cres, Welbeck",  address: "3 Lady Margaret Crescent, Welbeck, S80", price: 10, frequencyWeeks: 4 },
  { name: "2 Lady Margaret Cres, Welbeck",  address: "2 Lady Margaret Crescent, Welbeck, S80", price: 10, frequencyWeeks: 4 },
  { name: "3 New Bungalows, Norton",        address: "3 New Bungalows, Norton, NG22",          price: 10, frequencyWeeks: 4 },
  { name: "Rookeries, Norton",              address: "Rookeries, Norton, NG22",                price: 12, frequencyWeeks: 4 },
  { name: "Pear Tree Cottage, Norton",      address: "Pear Tree Cottage, Norton, NG22",        price: 12, frequencyWeeks: 8 },
  { name: "3 Main St Bungalow, Norton",     address: "3 Main Street Bungalow, Norton, NG22",   price: 10, frequencyWeeks: 4 },
  { name: "Rose Tree Cottage, Norton",      address: "Rose Tree Cottage, Norton, NG22",        price: 12, frequencyWeeks: 4 },
  { name: "South Carr Lodge, Norton",       address: "South Carr Lodge, Norton, NG22",         price: 20, frequencyWeeks: 4 },
  { name: "Tile Kiln Lodge, Norton",        address: "Tile Kiln Lodge, Norton, NG22",          price: 20, frequencyWeeks: 4 },
  { name: "Crags Lodge, Norton",            address: "Crags Lodge, Norton, NG22",              price: 20, frequencyWeeks: 4 },
  { name: "Ganabrig Lodge, Norton",         address: "Ganabrig Lodge, Norton, NG22",           price: 15, frequencyWeeks: 4 },
  { name: "Corner Bungalow, Holbeck",       address: "Corner Bungalow, Holbeck, NG22",         price: 10, frequencyWeeks: 4 },
  { name: "4 New Bungalows, Holbeck",       address: "4 New Bungalows, Holbeck, NG22",         price:  8, frequencyWeeks: 4 },
  { name: "5 New Bungalows, Holbeck",       address: "5 New Bungalows, Holbeck, NG22",         price:  8, frequencyWeeks: 4 },
  { name: "Barleycroft, Holbeck",           address: "Barleycroft, Holbeck, NG22",             price: 15, frequencyWeeks: 4 },
  { name: "Old Schoolhouse, Holbeck",       address: "Old Schoolhouse, Holbeck, NG22",         price: 15, frequencyWeeks: 4 },
  { name: "Windy Nook, Cuckney",            address: "Windy Nook, Cuckney, NG20",              price: 10, frequencyWeeks: 4 },
  { name: "Stonecroft, Cuckney",            address: "Stonecroft, Cuckney, NG20",              price: 11, frequencyWeeks: 4 },
  { name: "Old Bakehouse, Cuckney",         address: "Old Bakehouse, Cuckney, NG20",           price: 20, frequencyWeeks: 4 },
  { name: "John & Jayne, Cuckney",          address: "John & Jayne, Cuckney, NG20",            price: 12, frequencyWeeks: 4 },
];

const CARLTON_RHODESIA_CUSTOMERS = [
  { name: "2 Robertson Grove, Rhodesia",      address: "2 Robertson Grove, Rhodesia, S80",        price: 10, frequencyWeeks: 4 },
  { name: "2a Robertson Grove, Rhodesia",     address: "2a Robertson Grove, Rhodesia, S80",       price: 10, frequencyWeeks: 4 },
  { name: "4 Robertson Grove, Rhodesia",      address: "4 Robertson Grove, Rhodesia, S80",        price: 10, frequencyWeeks: 4 },
  { name: "31 Robertson Grove, Rhodesia",     address: "31 Robertson Grove, Rhodesia, S80",       price: 10, frequencyWeeks: 4 },
  { name: "32 Robertson Grove, Rhodesia",     address: "32 Robertson Grove, Rhodesia, S80",       price:  8, frequencyWeeks: 4 },
  { name: "36 Robertson Grove, Rhodesia",     address: "36 Robertson Grove, Rhodesia, S80",       price:  8, frequencyWeeks: 4 },
  { name: "37 Robertson Grove, Rhodesia",     address: "37 Robertson Grove, Rhodesia, S80",       price:  8, frequencyWeeks: 4 },
  { name: "38 Robertson Grove, Rhodesia",     address: "38 Robertson Grove, Rhodesia, S80",       price: 10, frequencyWeeks: 4 },
  { name: "39 Robertson Grove, Rhodesia",     address: "39 Robertson Grove, Rhodesia, S80",       price: 10, frequencyWeeks: 4 },
  { name: "40 Robertson Grove, Rhodesia",     address: "40 Robertson Grove, Rhodesia, S80",       price: 10, frequencyWeeks: 4 },
  { name: "41 Robertson Grove, Rhodesia",     address: "41 Robertson Grove, Rhodesia, S80",       price:  6, frequencyWeeks: 4 },
  { name: "2 Goranson Walk, Rhodesia",        address: "2 Goranson Walk, Rhodesia, S80",          price:  6, frequencyWeeks: 4 },
  { name: "22 Goranson Walk, Rhodesia",       address: "22 Goranson Walk, Rhodesia, S80",         price: 15, frequencyWeeks: 4 },
  { name: "13 Goranson Walk, Rhodesia",       address: "13 Goranson Walk, Rhodesia, S80",         price: 12, frequencyWeeks: 4 },
  { name: "9 Goranson Walk, Rhodesia",        address: "9 Goranson Walk, Rhodesia, S80",          price: 10, frequencyWeeks: 4 },
  { name: "54 Goranson Walk, Rhodesia",       address: "54 Goranson Walk, Rhodesia, S80",         price:  6, frequencyWeeks: 4 },
  { name: "1 Goranson Walk, Rhodesia",        address: "1 Goranson Walk, Rhodesia, S80",          price: 15, frequencyWeeks: 4 },
  { name: "2 Dormer Drive, Rhodesia",         address: "2 Dormer Drive, Rhodesia, S80",           price: 14, frequencyWeeks: 4 },
  { name: "4 Dormer Drive, Rhodesia",         address: "4 Dormer Drive, Rhodesia, S80",           price:  5, frequencyWeeks: 4 },
  { name: "1 Dormer Drive, Rhodesia",         address: "1 Dormer Drive, Rhodesia, S80",           price: 17, frequencyWeeks: 4 },
  { name: "68 Mary Street, Rhodesia",         address: "68 Mary Street, Rhodesia, S80",           price: 10, frequencyWeeks: 4 },
  { name: "5 Queen Elizabeth Cres, Rhodesia", address: "5 Queen Elizabeth Crescent, Rhodesia, S80",price:10, frequencyWeeks: 4 },
  { name: "6 Eider, Rhodesia",                address: "6 Eider Close, Rhodesia, S80",            price: 10, frequencyWeeks: 4 },
  { name: "1 Lockside, Rhodesia",             address: "1 Lockside, Rhodesia, S80",               price:  8, frequencyWeeks: 4 },
  { name: "2 Lockside, Rhodesia",             address: "2 Lockside, Rhodesia, S80",               price:  8, frequencyWeeks: 4 },
  { name: "3 Lockside, Rhodesia",             address: "3 Lockside, Rhodesia, S80",               price:  8, frequencyWeeks: 4 },
  { name: "4 Lockside, Rhodesia",             address: "4 Lockside, Rhodesia, S80",               price: 10, frequencyWeeks: 4 },
  { name: "233 Carlton Rd, Worksop",          address: "233 Carlton Road, Worksop, S81",          price: 15, frequencyWeeks: 4 },
  { name: "377 Carlton Rd, Worksop",          address: "377 Carlton Road, Worksop, S81",          price: 11, frequencyWeeks: 4 },
  { name: "469 Carlton Rd, Worksop",          address: "469 Carlton Road, Worksop, S81",          price: 12, frequencyWeeks: 4 },
  { name: "467 Carlton Rd, Worksop",          address: "467 Carlton Road, Worksop, S81",          price: 15, frequencyWeeks: 4 },
  { name: "457 Carlton Rd, Worksop",          address: "457 Carlton Road, Worksop, S81",          price: 12, frequencyWeeks: 4 },
  { name: "420 Carlton Rd, Worksop",          address: "420 Carlton Road, Worksop, S81",          price: 12, frequencyWeeks: 4 },
  { name: "418 Carlton Rd, Worksop",          address: "418 Carlton Road, Worksop, S81",          price:  8, frequencyWeeks: 4 },
  { name: "410 Carlton Rd, Worksop",          address: "410 Carlton Road, Worksop, S81",          price: 12, frequencyWeeks: 4 },
  { name: "28 Raines Ave, Worksop",           address: "28 Raines Avenue, Worksop, S81",          price: 10, frequencyWeeks: 4 },
  { name: "42 Raines Ave, Worksop",           address: "42 Raines Avenue, Worksop, S81",          price: 12, frequencyWeeks: 4 },
  { name: "44 Raines Ave, Worksop",           address: "44 Raines Avenue, Worksop, S81",          price: 10, frequencyWeeks: 4 },
  { name: "59 Raines Ave, Worksop",           address: "59 Raines Avenue, Worksop, S81",          price: 15, frequencyWeeks: 4 },
  { name: "361 Carlton Rd, Worksop",          address: "361 Carlton Road, Worksop, S81",          price: 20, frequencyWeeks: 4 },
  { name: "122 Keswick Rd, Worksop",          address: "122 Keswick Road, Worksop, S81",          price: 12, frequencyWeeks: 4 },
  { name: "98 Keswick Rd, Worksop",           address: "98 Keswick Road, Worksop, S81",           price: 12, frequencyWeeks: 4 },
  { name: "45 Keswick Rd, Worksop",           address: "45 Keswick Road, Worksop, S81",           price: 12, frequencyWeeks: 4 },
  { name: "24 Keswick Rd, Worksop",           address: "24 Keswick Road, Worksop, S81",           price: 12, frequencyWeeks: 4 },
  { name: "174 Newcastle Ave, Worksop",       address: "174 Newcastle Avenue, Worksop, S81",      price: 12, frequencyWeeks: 4 },
  { name: "160 Newcastle Ave, Worksop",       address: "160 Newcastle Avenue, Worksop, S81",      price: 15, frequencyWeeks: 4 },
  { name: "152 Newcastle Ave, Worksop",       address: "152 Newcastle Avenue, Worksop, S81",      price: 10, frequencyWeeks: 4 },
];

const GATEFORD_CUSTOMERS = [
  { name: "2 Hemmingfield Cres, Worksop",    address: "2 Hemmingfield Crescent, Worksop, S81",   price: 10, frequencyWeeks: 4 },
  { name: "4 Hemmingfield Cres, Worksop",    address: "4 Hemmingfield Crescent, Worksop, S81",   price: 12, frequencyWeeks: 4 },
  { name: "6 Hemmingfield Cres, Worksop",    address: "6 Hemmingfield Crescent, Worksop, S81",   price: 15, frequencyWeeks: 8 },
  { name: "1 Hemmingfield Cres, Worksop",    address: "1 Hemmingfield Crescent, Worksop, S81",   price: 12, frequencyWeeks: 4 },
  { name: "3 Hemmingfield Cres, Worksop",    address: "3 Hemmingfield Crescent, Worksop, S81",   price: 10, frequencyWeeks: 4 },
  { name: "7 Hemmingfield Cres, Worksop",    address: "7 Hemmingfield Crescent, Worksop, S81",   price: 15, frequencyWeeks: 4 },
  { name: "28 Hemmingfield Cres, Worksop",   address: "28 Hemmingfield Crescent, Worksop, S81",  price: 10, frequencyWeeks: 4 },
  { name: "1 Hemmingfield Way, Worksop",     address: "1 Hemmingfield Way, Worksop, S81",        price: 12, frequencyWeeks: 4 },
  { name: "8 Hemmingfield Road, Worksop",    address: "8 Hemmingfield Road, Worksop, S81",       price: 15, frequencyWeeks: 4 },
  { name: "9 Grasmere, Worksop",             address: "9 Grasmere Road, Gateford, Worksop, S81",  price:  8, frequencyWeeks: 4 },
  { name: "8 Grasmere, Worksop",             address: "8 Grasmere Road, Gateford, Worksop, S81",  price: 10, frequencyWeeks: 4 },
  { name: "10 Grasmere, Worksop",            address: "10 Grasmere Road, Gateford, Worksop, S81", price: 15, frequencyWeeks: 8 },
  { name: "12 Grasmere, Worksop",            address: "12 Grasmere Road, Gateford, Worksop, S81", price: 17, frequencyWeeks: 4 },
  { name: "6 Lodore Rd, Worksop",            address: "6 Lodore Road, Gateford, Worksop, S81",   price: 10, frequencyWeeks: 4 },
  { name: "8 Langdale Rd, Worksop",          address: "8 Langdale Road, Gateford, Worksop, S81",  price: 12, frequencyWeeks: 4 },
  { name: "12 Langdale Rd, Worksop",         address: "12 Langdale Road, Gateford, Worksop, S81", price: 15, frequencyWeeks: 4 },
  { name: "14 Langdale Rd, Worksop",         address: "14 Langdale Road, Gateford, Worksop, S81", price: 11, frequencyWeeks: 4 },
  { name: "11 Langdale Rd, Worksop",         address: "11 Langdale Road, Gateford, Worksop, S81", price: 10, frequencyWeeks: 4 },
  { name: "13 Langdale Rd, Worksop",         address: "13 Langdale Road, Gateford, Worksop, S81", price:  5, frequencyWeeks: 4 },
  { name: "15 Langdale Rd, Worksop",         address: "15 Langdale Road, Gateford, Worksop, S81", price: 10, frequencyWeeks: 4 },
  { name: "21 Langdale Rd, Worksop",         address: "21 Langdale Road, Gateford, Worksop, S81", price: 12, frequencyWeeks: 4 },
  { name: "93 Thievesdale Lane, Worksop",    address: "93 Thievesdale Lane, Worksop, S81",        price: 14, frequencyWeeks: 4 },
  { name: "46 Kilton Cres, Worksop",         address: "46 Kilton Crescent, Worksop, S81",         price: 12, frequencyWeeks: 4 },
  { name: "48 Kilton Cres, Worksop",         address: "48 Kilton Crescent, Worksop, S81",         price: 20, frequencyWeeks: 4 },
  { name: "15 Avon Way, Worksop",            address: "15 Avon Way, Worksop, S81",                price: 12, frequencyWeeks: 4 },
  { name: "17 Avon Way, Worksop",            address: "17 Avon Way, Worksop, S81",                price: 10, frequencyWeeks: 4 },
  { name: "19 Avon Way, Worksop",            address: "19 Avon Way, Worksop, S81",                price: 12, frequencyWeeks: 4 },
  { name: "21 Avon Way, Worksop",            address: "21 Avon Way, Worksop, S81",                price: 15, frequencyWeeks: 4 },
  { name: "23 Avon Way, Worksop",            address: "23 Avon Way, Worksop, S81",                price: 12, frequencyWeeks: 8 },
  { name: "27 Avon Way, Worksop",            address: "27 Avon Way, Worksop, S81",                price: 12, frequencyWeeks: 4 },
  { name: "31 Avon Way, Worksop",            address: "31 Avon Way, Worksop, S81",                price: 15, frequencyWeeks: 4 },
  { name: "13 Sheaf Place, Worksop",         address: "13 Sheaf Place, Worksop, S81",             price:  8, frequencyWeeks: 4 },
  { name: "15 Sheaf Place, Worksop",         address: "15 Sheaf Place, Worksop, S81",             price: 10, frequencyWeeks: 4 },
  { name: "17 Sheaf Place, Worksop",         address: "17 Sheaf Place, Worksop, S81",             price: 10, frequencyWeeks: 4 },
  { name: "19 Sheaf Place, Worksop",         address: "19 Sheaf Place, Worksop, S81",             price:  8, frequencyWeeks: 4 },
  { name: "3 Sheaf Place, Worksop",          address: "3 Sheaf Place, Worksop, S81",              price: 12, frequencyWeeks: 4 },
  { name: "25 Nene Walk, Worksop",           address: "25 Nene Walk, Worksop, S81",               price: 10, frequencyWeeks: 4 },
  { name: "27 Nene Walk, Worksop",           address: "27 Nene Walk, Worksop, S81",               price: 10, frequencyWeeks: 4 },
  { name: "24 Nene Walk, Worksop",           address: "24 Nene Walk, Worksop, S81",               price: 10, frequencyWeeks: 4 },
  { name: "33 Nene Walk, Worksop",           address: "33 Nene Walk, Worksop, S81",               price: 14, frequencyWeeks: 4 },
  { name: "22 Peregrine Court, Worksop",     address: "22 Peregrine Court, Worksop, S81",         price: 12, frequencyWeeks: 4 },
  { name: "24 Peregrine Court, Worksop",     address: "24 Peregrine Court, Worksop, S81",         price: 15, frequencyWeeks: 4 },
  { name: "26 Peregrine Court, Worksop",     address: "26 Peregrine Court, Worksop, S81",         price: 12, frequencyWeeks: 4 },
  { name: "9 Wren Court, Worksop",           address: "9 Wren Court, Worksop, S81",               price: 15, frequencyWeeks: 4 },
  { name: "2 Belgravia Ct, Worksop",         address: "2 Belgravia Court, Worksop, S81",          price: 15, frequencyWeeks: 4 },
];

const DALE_CLOSE_CUSTOMERS = [
  { name: "12 Dale Close, Worksop",   address: "12 Dale Close, Worksop, S80",   price: 10, frequencyWeeks: 4 },
  { name: "14 Dale Close, Worksop",   address: "14 Dale Close, Worksop, S80",   price: 15, frequencyWeeks: 4 },
  { name: "18 Dale Close, Worksop",   address: "18 Dale Close, Worksop, S80",   price: 10, frequencyWeeks: 4 },
  { name: "20 Dale Close, Worksop",   address: "20 Dale Close, Worksop, S80",   price: 10, frequencyWeeks: 4 },
  { name: "13 Dale Close, Worksop",   address: "13 Dale Close, Worksop, S80",   price: 10, frequencyWeeks: 4 },
  { name: "74 Dale Close, Worksop",   address: "74 Dale Close, Worksop, S80",   price: 10, frequencyWeeks: 4 },
  { name: "76 Dale Close, Worksop",   address: "76 Dale Close, Worksop, S80",   price: 10, frequencyWeeks: 4 },
  { name: "129 Dale Close, Worksop",  address: "129 Dale Close, Worksop, S80",  price: 10, frequencyWeeks: 4 },
  { name: "132 Dale Close, Worksop",  address: "132 Dale Close, Worksop, S80",  price: 10, frequencyWeeks: 4 },
  { name: "134 Dale Close, Worksop",  address: "134 Dale Close, Worksop, S80",  price: 15, frequencyWeeks: 4 },
  { name: "140 Dale Close, Worksop",  address: "140 Dale Close, Worksop, S80",  price: 10, frequencyWeeks: 4 },
  { name: "142 Dale Close, Worksop",  address: "142 Dale Close, Worksop, S80",  price: 10, frequencyWeeks: 4 },
  { name: "137 Dale Close, Worksop",  address: "137 Dale Close, Worksop, S80",  price: 10, frequencyWeeks: 4 },
  { name: "135 Dale Close, Worksop",  address: "135 Dale Close, Worksop, S80",  price: 10, frequencyWeeks: 4 },
  { name: "133 Dale Close, Worksop",  address: "133 Dale Close, Worksop, S80",  price: 10, frequencyWeeks: 4 },
  { name: "119 Dale Close, Worksop",  address: "119 Dale Close, Worksop, S80",  price: 10, frequencyWeeks: 4 },
  { name: "125 Dale Close, Worksop",  address: "125 Dale Close, Worksop, S80",  price: 10, frequencyWeeks: 4 },
  { name: "107 Dale Close, Worksop",  address: "107 Dale Close, Worksop, S80",  price: 10, frequencyWeeks: 4 },
  { name: "105 Dale Close, Worksop",  address: "105 Dale Close, Worksop, S80",  price: 10, frequencyWeeks: 4 },
  { name: "69 Woodlands, Worksop",    address: "69 Woodlands Road, Worksop, S80",price:10, frequencyWeeks: 4 },
  { name: "72 Woodlands, Worksop",    address: "72 Woodlands Road, Worksop, S80",price:10, frequencyWeeks: 4 },
];

// ── Main seed ─────────────────────────────────────────────────────────────────

async function main() {
  console.log("🌱 Seeding database with real customer data (Worksop area, UK)...");

  // Clean existing transactional data — preserve BusinessSettings and Tags
  await prisma.customerTag.deleteMany();
  await prisma.payment.deleteMany();
  await prisma.job.deleteMany();
  await prisma.workDay.deleteMany();
  await prisma.customer.deleteMany();
  await prisma.area.deleteMany();

  // ── Create all 11 areas ───────────────────────────────────────────────────
  const [
    langold,
    modelWay,
    rogersPortland,
    creswellWestSt,
    elmtonRd,
    bolsover,
    edwinstowe,
    welbeck,
    carltonRhodesia,
    gateford,
    daleClose,
  ] = await Promise.all([
    prisma.area.create({ data: { name: "Langold & Tuxford - 4 Weekly",       color: "#3B82F6", sortOrder:  1, scheduleType: "WEEKLY", frequencyWeeks: 4, nextDueDate: utcDay(new Date("2026-03-16")) } }),
    prisma.area.create({ data: { name: "Creswell Model Way - 4 Weekly",      color: "#10B981", sortOrder:  2, scheduleType: "WEEKLY", frequencyWeeks: 4, nextDueDate: utcDay(new Date("2026-03-17")) } }),
    prisma.area.create({ data: { name: "Rogers & Portland - 4 Weekly",       color: "#F59E0B", sortOrder:  3, scheduleType: "WEEKLY", frequencyWeeks: 4, nextDueDate: utcDay(new Date("2026-03-18")) } }),
    prisma.area.create({ data: { name: "Creswell / West St - 4 Weekly",      color: "#EF4444", sortOrder:  4, scheduleType: "WEEKLY", frequencyWeeks: 4, nextDueDate: utcDay(new Date("2026-03-19")) } }),
    prisma.area.create({ data: { name: "Elmton Road - 4 Weekly",             color: "#8B5CF6", sortOrder:  5, scheduleType: "WEEKLY", frequencyWeeks: 4, nextDueDate: utcDay(new Date("2026-03-20")) } }),
    prisma.area.create({ data: { name: "Bolsover & Clowne - 4 Weekly",       color: "#06B6D4", sortOrder:  6, scheduleType: "WEEKLY", frequencyWeeks: 4, nextDueDate: utcDay(new Date("2026-03-23")) } }),
    prisma.area.create({ data: { name: "Edwinstowe - 4 Weekly",              color: "#F97316", sortOrder:  7, scheduleType: "WEEKLY", frequencyWeeks: 4, nextDueDate: utcDay(new Date("2026-03-24")) } }),
    prisma.area.create({ data: { name: "Welbeck & Norton - 4 Weekly",        color: "#6366F1", sortOrder:  8, scheduleType: "WEEKLY", frequencyWeeks: 4, nextDueDate: utcDay(new Date("2026-03-25")) } }),
    prisma.area.create({ data: { name: "Carlton Rd & Rhodesia - 4 Weekly",   color: "#D946EF", sortOrder:  9, scheduleType: "WEEKLY", frequencyWeeks: 4, nextDueDate: utcDay(new Date("2026-03-26")) } }),
    prisma.area.create({ data: { name: "Gateford / Hemmingfield - 4 Weekly", color: "#14B8A6", sortOrder: 10, scheduleType: "WEEKLY", frequencyWeeks: 4, nextDueDate: utcDay(new Date("2026-03-27")) } }),
    prisma.area.create({ data: { name: "Dale Close - 4 Weekly",              color: "#84CC16", sortOrder: 11, scheduleType: "WEEKLY", frequencyWeeks: 4, nextDueDate: utcDay(new Date("2026-03-30")) } }),
  ]);

  console.log("✅ 11 areas created");

  // ── Helper: bulk-create customers for an area ─────────────────────────────
  async function seedCustomers(
    areaId: number,
    list: Array<{ name: string; address: string; price: number; frequencyWeeks: number }>
  ) {
    for (const c of list) {
      await prisma.customer.create({
        data: {
          name: c.name,
          address: c.address,
          areaId,
          price: c.price,
          frequencyWeeks: c.frequencyWeeks,
          nextDueDate: null,   // null = never cleaned; scheduleAreaRun picks them up on first run
          active: true,
        },
      });
    }
  }

  await seedCustomers(langold.id,          LANGOLD_CUSTOMERS);
  await seedCustomers(modelWay.id,         MODEL_WAY_CUSTOMERS);
  await seedCustomers(rogersPortland.id,   ROGERS_PORTLAND_CUSTOMERS);
  await seedCustomers(creswellWestSt.id,   CRESWELL_CUSTOMERS);
  await seedCustomers(elmtonRd.id,         ELMTON_CUSTOMERS);
  await seedCustomers(bolsover.id,         BOLSOVER_CUSTOMERS);
  await seedCustomers(edwinstowe.id,       EDWINSTOWE_CUSTOMERS);
  await seedCustomers(welbeck.id,          WELBECK_CUSTOMERS);
  await seedCustomers(carltonRhodesia.id,  CARLTON_RHODESIA_CUSTOMERS);
  await seedCustomers(gateford.id,         GATEFORD_CUSTOMERS);
  await seedCustomers(daleClose.id,        DALE_CLOSE_CUSTOMERS);

  const total = await prisma.customer.count();
  console.log(`✅ Seeded ${total} customers across 11 areas`);
  console.log("\n🎉 Seed complete!");
  console.log("   11 areas · all 4-weekly · 8-weekly/12-weekly customers included via nextDueDate filtering");
  console.log("   Areas: Langold & Tuxford · Creswell Model Way · Rogers & Portland · Creswell / West St");
  console.log("          Elmton Road · Bolsover & Clowne · Edwinstowe · Welbeck & Norton");
  console.log("          Carlton Rd & Rhodesia · Gateford / Hemmingfield · Dale Close");
}

main()
  .catch((e) => { console.error(e); process.exit(1); })
  .finally(() => prisma.$disconnect());
