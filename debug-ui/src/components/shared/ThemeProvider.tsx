import { useEffect } from 'react'

// This component handles the initial loading of theme
export function ThemeProvider() {
  useEffect(() => {
    // On page load, check theme preference
    const initializeTheme = () => {
      // Check local storage
      const storedTheme = localStorage.getItem('theme')
      
      // Check system preference
      const systemPreference = window.matchMedia('(prefers-color-scheme: dark)').matches
        ? 'dark'
        : 'light'
      
      // Set theme based on storage or system preference
      if (storedTheme === 'dark' || (!storedTheme && systemPreference === 'dark')) {
        document.documentElement.classList.add('dark')
      } else {
        document.documentElement.classList.remove('dark')
      }
    }
    
    // Initialize theme
    initializeTheme()
    
    // Listen for changes in system preference
    const mediaQuery = window.matchMedia('(prefers-color-scheme: dark)')
    const handleChange = (e: MediaQueryListEvent) => {
      // Only change if no theme is stored
      if (!localStorage.getItem('theme')) {
        if (e.matches) {
          document.documentElement.classList.add('dark')
        } else {
          document.documentElement.classList.remove('dark')
        }
      }
    }
    
    // Add listener for system preference changes
    mediaQuery.addEventListener('change', handleChange)
    
    // Clean up
    return () => {
      mediaQuery.removeEventListener('change', handleChange)
    }
  }, [])
  
  return null
}