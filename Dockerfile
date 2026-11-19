FROM node:22-bookworm-slim

WORKDIR /app
COPY package*.json ./
RUN npm install --omit=dev --no-audit --no-fund
COPY . .

ENV NODE_ENV=production
ENV PORT=3000
# مجلد البيانات: اربطه بـ volume حتى لا تضيع الحسابات عند إعادة النشر
VOLUME ["/app/data"]
EXPOSE 3000
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 CMD node -e "require('http').get('http://127.0.0.1:'+process.env.PORT+'/healthz',r=>process.exit(r.statusCode<400?0:1)).on('error',()=>process.exit(1))"
CMD ["npm","start"]
