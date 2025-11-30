import { PrismaClient } from '@prisma/client'
import { PrismaPg } from '@prisma/adapter-pg'
import { Pool } from 'pg'

const globalForPrisma = global as unknown as { 
  prisma: PrismaClient
  pool: Pool
}

function createPrismaClient() {
  const pool = globalForPrisma.pool || new Pool({
    connectionString: process.env.DATABASE_URL
  })
  
  if (process.env.NODE_ENV !== 'production') {
    globalForPrisma.pool = pool
  }
  
  const adapter = new PrismaPg(pool)
  
  return new PrismaClient({
    adapter,
    log: process.env.NODE_ENV === 'development' ? ['query', 'error', 'warn'] : ['error'],
  })
}

const prisma = globalForPrisma.prisma || createPrismaClient()

if (process.env.NODE_ENV !== 'production') {
  globalForPrisma.prisma = prisma
}

export default prisma
export const db = prisma