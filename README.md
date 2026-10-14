# Galería de imágenes con Amazon S3 y presigned URLs (Lab S09)

Aplicación web para subir, listar, previsualizar y eliminar imágenes en un bucket **privado** de Amazon S3.
El navegador **nunca** recibe credenciales de AWS: el backend emite URLs prefirmadas de corta duración
y el archivo viaja directo del navegador a S3.

```
Navegador --1) POST /api/upload-url--> Backend (Express) --firma--> URL prefirmada (PUT, 5 min)
Navegador --2) PUT de la imagen directo a S3 (sin pasar por el backend)
Navegador --3) GET /api/images--> URLs prefirmadas de visualización (15 min)
```

## Estructura

```
backend/
  server.js          API Express (AWS SDK v3)
  package.json
  .env.example       plantilla de configuración (copiar a .env)
frontend/
  index.html  app.js  styles.css
```

## Requisitos

- Node.js 18 o superior y npm
- Un bucket S3 privado (Block all public access activado) en la región indicada
- Credenciales de AWS con permisos mínimos sobre ese bucket
  (`s3:GetObject`, `s3:PutObject`, `s3:DeleteObject`, `s3:ListBucket`)
- CORS configurado en el bucket (ver más abajo)

## Cómo arrancar

1. Clonar el repositorio e instalar dependencias:

   ```bash
   git clone https://github.com/faviosolorzano/Galeria_Lab09.git
   cd Galeria_Lab09/backend
   npm install
   ```

2. Crear el archivo de configuración a partir de la plantilla:

   ```bash
   # Windows (PowerShell / CMD)
   copy .env.example .env
   # Linux / macOS
   cp .env.example .env
   ```

   Editar `.env`:

   ```
   AWS_REGION=us-east-1
   S3_BUCKET=<nombre-de-tu-bucket>
   AWS_PROFILE=app-user
   PORT=3000
   ```

3. Configurar las credenciales **fuera del código**. Opción recomendada, con un perfil de la AWS CLI:

   ```bash
   aws configure --profile app-user
   ```

   (Alternativa: definir `AWS_ACCESS_KEY_ID` y `AWS_SECRET_ACCESS_KEY` en `.env` y quitar `AWS_PROFILE`.
   Si la app corre en EC2/ECS/Lambda, usar un IAM Role y no definir claves.)

4. Iniciar el servidor:

   ```bash
   npm start
   ```

5. Abrir <http://localhost:3000> en el navegador.

## CORS del bucket

En S3 → bucket → Permisos → CORS:

```json
[
  {
    "AllowedHeaders": ["*"],
    "AllowedMethods": ["PUT", "GET"],
    "AllowedOrigins": ["http://localhost:8080", "http://localhost:3000"],
    "ExposeHeaders": ["ETag"],
    "MaxAgeSeconds": 3000
  }
]
```

En producción, `AllowedOrigins` debe contener solo el dominio real de la aplicación (nunca `*`).

## API

| Método | Ruta | Descripción |
|---|---|---|
| POST | `/api/upload-url` | Recibe `{ filename, contentType, sizeBytes }` y devuelve una URL prefirmada de subida (5 min) |
| GET | `/api/images` | Lista las imágenes con URLs prefirmadas de visualización (15 min) |
| DELETE | `/api/images/:key` | Elimina la imagen (la clave se envía con `encodeURIComponent`) |

## Medidas de seguridad

- Bucket privado; acceso solo mediante URLs prefirmadas de corta duración.
- Sin credenciales en el frontend; `.env` y `.aws/` están en `.gitignore`.
- Validación de tipo (`image/jpeg`, `image/png`, `image/webp`) y tamaño (< 5 MB) en el frontend **y** en el backend.
- Nombres de archivo sanitizados y claves únicas (timestamp + valor aleatorio).
- Cifrado en reposo SSE-S3 (`AES256`) solicitado en cada subida.
- Rate limiting: 60 solicitudes por minuto sobre `/api`.
- CORS del backend limitado a `localhost:3000` y `localhost:8080`.

## Panel de pruebas

La página incluye un panel que llama directo al backend para demostrar sus validaciones
(archivo de 10 MB y tipo PDF → respuesta HTTP 400), y cada imagen muestra una cuenta
regresiva de 15 minutos hasta que expira su URL prefirmada.

## Limpieza

Al terminar, eliminar los recursos para evitar costos: vaciar y borrar el bucket, y desactivar
o eliminar el usuario IAM y sus claves de acceso.
