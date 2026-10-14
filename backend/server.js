require('dotenv').config();
const path = require('path');
const crypto = require('crypto');
const express = require('express');
const cors = require('cors');
const rateLimit = require('express-rate-limit');
const {
  S3Client, PutObjectCommand, GetObjectCommand,
  DeleteObjectCommand, ListObjectsV2Command
} = require('@aws-sdk/client-s3');
const { getSignedUrl } = require('@aws-sdk/s3-request-presigner');

const app = express();
const PORT = process.env.PORT || 3000;
const BUCKET = process.env.S3_BUCKET;
const PREFIX = 'originales/';
const ALLOWED_TYPES = ['image/jpeg', 'image/png', 'image/webp'];
const MAX_SIZE_MB = 5;
const UPLOAD_EXPIRES = 300; // 5 minutos
const VIEW_EXPIRES = 900;   // 15 minutos

if (!BUCKET) {
  console.error('Falta S3_BUCKET en el archivo .env');
  process.exit(1);
}

// Las credenciales las resuelve el AWS SDK (perfil o variables de entorno);
// nunca se envian al navegador.
const s3 = new S3Client({ region: process.env.AWS_REGION });

app.use(cors({ origin: ['http://localhost:8080', 'http://localhost:3000'] }));
app.use(express.json({ limit: '10kb' }));

// Rate limiting: evita abuso de los endpoints que emiten URLs
app.use('/api/', rateLimit({ windowMs: 60 * 1000, max: 60 }));

// Frontend estatico (tambien se puede servir por separado en el puerto 8080)
app.use(express.static(path.join(__dirname, '..', 'frontend')));

// 1) Presigned URL para subir
app.post('/api/upload-url', async (req, res) => {
  try {
    const { filename, contentType, sizeBytes } = req.body || {};
    if (typeof filename !== 'string' || !filename.trim()) {
      return res.status(400).json({ error: 'Nombre de archivo invalido' });
    }
    if (!ALLOWED_TYPES.includes(contentType)) {
      return res.status(400).json({ error: 'Tipo de archivo no permitido' });
    }
    if (!Number.isFinite(sizeBytes) || sizeBytes <= 0) {
      return res.status(400).json({ error: 'Tamano invalido' });
    }
    if (sizeBytes > MAX_SIZE_MB * 1024 * 1024) {
      return res.status(400).json({ error: 'Archivo demasiado grande (maximo 5 MB)' });
    }

    // Nombre seguro y unico (sin rutas ni caracteres raros)
    const safeName = path.basename(filename).replace(/[^a-zA-Z0-9._-]/g, '_').slice(-100);
    const key = `${PREFIX}${Date.now()}-${crypto.randomBytes(6).toString('hex')}-${safeName}`;

    const cmd = new PutObjectCommand({
      Bucket: BUCKET,
      Key: key,
      ContentType: contentType,
      ServerSideEncryption: 'AES256'
    });
    const uploadUrl = await getSignedUrl(s3, cmd, { expiresIn: UPLOAD_EXPIRES });
    res.json({ uploadUrl, key, expiresIn: UPLOAD_EXPIRES });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'No se pudo generar la URL de carga' });
  }
});

// 2) Listar imagenes con presigned URLs de visualizacion
app.get('/api/images', async (req, res) => {
  try {
    const list = await s3.send(new ListObjectsV2Command({ Bucket: BUCKET, Prefix: PREFIX }));
    const objects = (list.Contents || [])
      .filter(o => !o.Key.endsWith('/') && /\.(jpe?g|png|webp)$/i.test(o.Key));
    const items = await Promise.all(objects.map(async obj => {
      const url = await getSignedUrl(
        s3,
        new GetObjectCommand({ Bucket: BUCKET, Key: obj.Key }),
        { expiresIn: VIEW_EXPIRES }
      );
      return { key: obj.Key, size: obj.Size, lastModified: obj.LastModified, url };
    }));
    items.sort((a, b) => new Date(b.lastModified) - new Date(a.lastModified));
    res.json(items);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'No se pudo listar las imagenes' });
  }
});

// 3) Eliminar imagen (la clave llega codificada con encodeURIComponent)
app.delete('/api/images/:key', async (req, res) => {
  try {
    const key = req.params.key;
    if (!key.startsWith(PREFIX) || key.includes('..')) {
      return res.status(400).json({ error: 'Clave invalida' });
    }
    await s3.send(new DeleteObjectCommand({ Bucket: BUCKET, Key: key }));
    res.json({ deleted: true });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'No se pudo eliminar la imagen' });
  }
});

app.listen(PORT, () => console.log(`API escuchando en http://localhost:${PORT}`));
