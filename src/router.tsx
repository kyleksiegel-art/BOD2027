import { createBrowserRouter, Navigate } from 'react-router-dom'
import { Layout } from '@/components/Layout'
import Home from '@/routes/Home'
import Standings from '@/routes/Standings'
import Rounds from '@/routes/Rounds'
import RoundDetail from '@/routes/RoundDetail'
import Enter from '@/routes/Enter'
import Money from '@/routes/Money'
import Admin from '@/routes/Admin'
import Diagnostics from '@/routes/Diagnostics'
import NotFound from '@/routes/NotFound'
import InfoLayout from '@/routes/info/InfoLayout'
import Itinerary from '@/routes/info/Itinerary'
import Courses from '@/routes/info/Courses'
import CourseDetail from '@/routes/info/CourseDetail'
import Players from '@/routes/info/Players'
import Rules from '@/routes/info/Rules'
import SideGames from '@/routes/info/SideGames'

export const router = createBrowserRouter([
  {
    element: <Layout />,
    children: [
      { path: '/', element: <Home /> },
      { path: '/standings', element: <Standings /> },
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
])
