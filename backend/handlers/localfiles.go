package handlers

import (
	"net/http"
	"os"
	"path/filepath"
	"strings"

	"github.com/gin-gonic/gin"
)

// File extensions mapped to Vulos app types
var extToType = map[string]string{
	".doc":  "doc",
	".docx": "doc",
	".txt":  "doc",
	".md":   "doc",
	".rtf":  "doc",
	".odt":  "doc",
	".xls":  "sheet",
	".xlsx": "sheet",
	".csv":  "sheet",
	".ods":  "sheet",
	".ppt":  "slide",
	".pptx": "slide",
	".odp":  "slide",
	".pdf":  "pdf",
}

type LocalFile struct {
	Name     string `json:"name"`
	Path     string `json:"path"`
	Ext      string `json:"ext"`
	AppType  string `json:"appType"`
	Size     int64  `json:"size"`
	Modified int64  `json:"modified"` // unix ms
}

type LocalFilesHandler struct {
	scanDirs []string
}

func NewLocalFilesHandler() *LocalFilesHandler {
	home, _ := os.UserHomeDir()
	return &LocalFilesHandler{
		scanDirs: []string{
			filepath.Join(home, "Documents"),
			filepath.Join(home, "Downloads"),
			filepath.Join(home, "Desktop"),
		},
	}
}

func (h *LocalFilesHandler) Scan(c *gin.Context) {
	var results []LocalFile

	for _, dir := range h.scanDirs {
		_ = filepath.Walk(dir, func(path string, info os.FileInfo, err error) error {
			if err != nil || info == nil || info.IsDir() {
				return nil
			}
			// Skip hidden files and deep nested dirs (max 2 levels)
			rel, _ := filepath.Rel(dir, path)
			if strings.HasPrefix(info.Name(), ".") {
				return nil
			}
			depth := strings.Count(rel, string(os.PathSeparator))
			if depth > 2 {
				return filepath.SkipDir
			}

			ext := strings.ToLower(filepath.Ext(info.Name()))
			appType, ok := extToType[ext]
			if !ok {
				return nil
			}

			results = append(results, LocalFile{
				Name:     info.Name(),
				Path:     path,
				Ext:      ext,
				AppType:  appType,
				Size:     info.Size(),
				Modified: info.ModTime().UnixMilli(),
			})
			return nil
		})
	}

	if results == nil {
		results = []LocalFile{}
	}
	c.JSON(http.StatusOK, results)
}

func (h *LocalFilesHandler) Serve(c *gin.Context) {
	path := c.Query("path")
	if path == "" {
		c.JSON(http.StatusBadRequest, gin.H{"error": "path required"})
		return
	}

	// Security: the requested path must be CONTAINED within one of the allowed
	// scan dirs. A naive strings.HasPrefix check is bypassable — e.g.
	// "/Users/pc/Documents-evil" has the prefix "/Users/pc/Documents" yet
	// escapes the directory. Use filepath.Rel and reject any result that is
	// absolute or climbs out with "..", which gives proper containment AND
	// handles traversal (so the "../" check no longer has to run after Clean).
	cleanPath := filepath.Clean(path)
	contained := false
	for _, dir := range h.scanDirs {
		rel, err := filepath.Rel(filepath.Clean(dir), cleanPath)
		if err != nil {
			continue
		}
		// rel == "." (the dir itself) or a descendant is allowed; anything that
		// starts with ".." (or is the literal "..") escapes the dir, and an
		// absolute rel means different volumes — both rejected.
		if rel == ".." || strings.HasPrefix(rel, ".."+string(os.PathSeparator)) || filepath.IsAbs(rel) {
			continue
		}
		contained = true
		break
	}
	if !contained {
		c.JSON(http.StatusForbidden, gin.H{"error": "path not allowed"})
		return
	}

	info, err := os.Stat(cleanPath)
	if err != nil || info.IsDir() {
		c.JSON(http.StatusNotFound, gin.H{"error": "file not found"})
		return
	}

	c.Header("Content-Disposition", `inline; filename="`+filepath.Base(path)+`"`)
	c.File(path)
}
