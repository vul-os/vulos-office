package main

import (
	"embed"
	"io/fs"
	"log"
	"net/http"

	"vulos-office/backend/config"
	"vulos-office/backend/handlers"
	"vulos-office/backend/middleware"
	"vulos-office/backend/storage"

	"github.com/gin-contrib/cors"
	"github.com/gin-gonic/gin"
)

//go:embed all:dist
var distFS embed.FS

func main() {
	cfg, err := config.Load("config.yaml")
	if err != nil {
		log.Printf("Config error: %v — using defaults", err)
		cfg = config.Default()
	}

	store, err := storage.New(cfg)
	if err != nil {
		log.Fatal("Storage init failed:", err)
	}

	gin.SetMode(gin.ReleaseMode)
	r := gin.Default()

	r.Use(cors.New(cors.Config{
		AllowAllOrigins:  true,
		AllowMethods:     []string{"GET", "POST", "PUT", "DELETE", "OPTIONS"},
		AllowHeaders:     []string{"Origin", "Content-Type", "Authorization"},
	}))

	// Auth routes (unauthenticated)
	authHandler := handlers.NewAuthHandler(cfg)
	api := r.Group("/api")
	api.POST("/auth/login", authHandler.Login)
	api.POST("/auth/logout", authHandler.Logout)
	api.GET("/auth/status", authHandler.Status)

	// Protected API routes
	protected := api.Group("/")
	if cfg.Auth.Enabled {
		protected.Use(middleware.Auth(cfg))
	}

	fileHandler := handlers.NewFileHandler(store)
	protected.GET("/files", fileHandler.List)
	protected.GET("/files/:id", fileHandler.Get)
	protected.POST("/files", fileHandler.Create)
	protected.PUT("/files/:id", fileHandler.Update)
	protected.DELETE("/files/:id", fileHandler.Delete)

	uploadHandler := handlers.NewUploadHandler(cfg)
	protected.POST("/upload", uploadHandler.Upload)
	api.GET("/uploads/:filename", uploadHandler.Serve)

	localFilesHandler := handlers.NewLocalFilesHandler()
	protected.GET("/local-files", localFilesHandler.Scan)
	protected.GET("/local-files/serve", localFilesHandler.Serve)

	// Serve embedded frontend (SPA fallback to index.html)
	staticFS, err := fs.Sub(distFS, "dist")
	if err != nil {
		log.Fatal("Failed to create static FS:", err)
	}
	staticServer := http.FileServer(http.FS(staticFS))

	r.NoRoute(func(c *gin.Context) {
		path := c.Request.URL.Path
		// Try to open the path as a file in staticFS
		f, err := staticFS.Open(path)
		if err == nil {
			f.Close()
			staticServer.ServeHTTP(c.Writer, c.Request)
			return
		}
		// SPA fallback: serve index.html
		c.Request.URL.Path = "/"
		staticServer.ServeHTTP(c.Writer, c.Request)
	})

	addr := cfg.Server.Addr
	if addr == "" {
		addr = ":8080"
	}

	log.Printf("Vulos Office running → http://localhost%s", addr)
	if err := r.Run(addr); err != nil {
		log.Fatal(err)
	}
}
