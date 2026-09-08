import { lazy } from 'react'
import { createBrowserRouter, Navigate } from 'react-router-dom'
import { Layout } from '@/components/Layout'
import { RouteErrorPanel, RouteFrame } from '@/components/ErrorBoundary'
// Home is eager: it is the landing page, so paint it the instant the main bundle lands
// rather than flashing the Suspense fallback. Every other page is a lazy chunk, split out
// of the initial bundle and precached by the service worker after the first visit. The one
// Suspense boundary that resolves them lives in RouteFrame (ErrorBoundary.tsx).
import Home from '@/routes/Home'

const Standings = lazy(() => import('@/routes/Standings'))
const FieldReport = lazy(() => import('@/routes/FieldReport'))
const Rounds = lazy(() => import('@/routes/Rounds'))
const RoundDetail = lazy(() => import('@/routes/RoundDetail'))
const Enter = lazy(() => import('@/routes/Enter'))
const Money = lazy(() => import('@/routes/Money'))
const Admin = lazy(() => import('@/routes/Admin'))
const Diagnostics = lazy(() => import('@/routes/Diagnostics'))
const NotFound = lazy(() => import('@/routes/NotFound'))
const InfoLayout = lazy(() => import('@/routes/info/InfoLayout'))
const Itinerary = lazy(() => import('@/routes/info/Itinerary'))
const Courses = lazy(() => import('@/routes/info/Courses'))
const CourseDetail = lazy(() => import('@/routes/info/CourseDetail'))
const Players = lazy(() => import('@/routes/info/Players'))
const Rules = lazy(() => import('@/routes/info/Rules'))
const SideGames = lazy(() => import('@/routes/info/SideGames'))

export const router = createBrowserRouter([
  {
    element: <Layout />,
    // Layout itself threw: no shell survives, our panel replaces react-router's default page.
    errorElement: <RouteErrorPanel scope="shell" />,
    children: [
      {
        // Pathless: a page that throws renders RouteErrorPanel HERE, inside Layout's
        // Outlet, so the tab bar stays up. On the Layout route itself the shell would go too.
        element: <RouteFrame />,
        errorElement: <RouteErrorPanel />,
        children: [
      { path: '/', element: <Home /> },
      { path: '/standings', element: <Standings /> },
      { path: '/standings/wire', element: <FieldReport /> },
      { path: '/rounds', element: <Rounds /> },
      { path: '/rounds/:roundNumber', element: <RoundDetail /> },
      { path: '/enter', element: <Enter /> },
      { path: '/money', element: <Money /> },
      {
        path: '/info',
        element: <InfoLayout />,
        children: [
          { index: true, element: <Navigate to="itinerary" replace /> },
          { path: 'itinerary', element: <Itinerary /> },
          { path: 'courses', element: <Courses /> },
          { path: 'courses/:courseId', element: <CourseDetail /> },
          { path: 'players', element: <Players /> },
          { path: 'rules', element: <Rules /> },
          { path: 'side-games', element: <SideGames /> },
        ],
      },
      { path: '/admin', element: <Admin /> },
      { path: '/diagnostics', element: <Diagnostics /> },
      { path: '*', element: <NotFound /> },
        ],
      },
    ],
  },
])
