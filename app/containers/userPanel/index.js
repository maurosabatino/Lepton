'use strict'

import React, { Component } from 'react'
import { connect } from 'react-redux'
import { bindActionCreators } from 'redux'
import { Image, Modal, Button, ProgressBar } from 'react-bootstrap'
import GistEditorForm from '../gistEditorForm'
import { NEW_GIST } from '../gistEditorForm'
import HumanReadableTime from 'human-readable-time'
import Notifier from '../../utilities/notifier'
import './index.scss'
import {
  addLangPrefix as Prefixed,
  parseCustomTags,
  descriptionParser } from '../../utilities/parser'

import {
  removeAccessToken,
  logoutUserSession,
  updateSingleGist,
  updateGistTags,
  selectGistTag,
  selectGist,
  updateGistNewModeStatus,
  updateLogoutModalStatus } from '../../actions/index'

import {
  getGitHubApi,
  CREATE_SINGLE_GIST
} from '../../utilities/githubApi'

import { shell, remote, ipcRenderer } from 'electron'
const logger = remote.getGlobal('logger')

class UserPanel extends Component {

  componentWillMount () {
    ipcRenderer.on('new-gist-renderer', () => {
      this.handleNewGistClicked()
    })
  }

  componentWillUnmount () {
    ipcRenderer.removeAllListeners('new-gist-renderer')
  }

  handleCreateSingleGist (data) {
    const isPublic = data.private === undefined ? true : !data.private
    const description = data.description.trim()
    const processedFiles = {}

    data.gistFiles.forEach((file) => {
      processedFiles[file.filename.trim()] = {
        content: file.content
      }
    })

    return getGitHubApi(CREATE_SINGLE_GIST)(this.props.accessToken, description, processedFiles, isPublic)
      .catch((err) => {
        Notifier('Gist creation failed')
        logger.error(JSON.stringify(err))
      })
      .then((response) => {
        this.updateGistsStoreWithNewGist(response)
      })
      .finally(() => {
        this.closeGistEditorModal()
      })
  }

  updateGistsStoreWithNewGist (gistDetails) {
    const {
      gistTags,
      updateSingleGist,
      updateGistTags,
      selectGistTag,
      selectGist,
      searchIndex } = this.props

    const gistId = gistDetails.id
    const files = gistDetails.files

    // update the language tags
    const langs = new Set()
    let filenameRecords = ''

    gistTags[Prefixed('All')].unshift(gistId)
    Object.keys(files).forEach(filename => {
      filenameRecords = ',' + filename
      const language = files[filename].language || 'Other'
      langs.add(language)
      const prefixedLang = Prefixed(language)
      if (gistTags.hasOwnProperty(prefixedLang)) {
        gistTags[prefixedLang].unshift(gistId)
      } else {
        gistTags[prefixedLang] = []
        gistTags[prefixedLang].unshift(gistId)
      }
    })

    // update the custom tags
    const customTags = parseCustomTags(descriptionParser(gistDetails.description).customTags)
    customTags.forEach(tag => {
      if (gistTags.hasOwnProperty(tag)) {
        gistTags[tag].unshift(gistDetails.id)
      } else {
        gistTags[tag] = []
        gistTags[tag].unshift(gistDetails.id)
      }
    })

    const newGist = {}
    newGist[gistId] = {
      langs: langs,
      brief: gistDetails,
      details: gistDetails
    }
    logger.info('[Dispatch] updateSingleGist')
    updateSingleGist(newGist)

    logger.info('[Dispatch] updateGistTags')
    updateGistTags(gistTags)

    logger.info('[Dispatch] selectGistTag')
    selectGistTag(Prefixed('All'))

    logger.info('[Dispatch] selectGist')
    selectGist(gistId)

    let langSearchRecords = ''
    langs.forEach(lang => {
      langSearchRecords += ',' + lang
    })

    // update the search index
    searchIndex.addToFuseIndex({
      id: gistId,
      description: gistDetails.description,
      language: langSearchRecords,
      filename: filenameRecords
    })

    Notifier('Gist created', HumanReadableTime(new Date()))
  }

  renderGistEditorModalBody () {
    const initialData = {
      description: '',
      gists: [
          {filename: '', content: ''}
      ]}
    return (
      <GistEditorForm
        initialData={ initialData }
        formStyle={ NEW_GIST }
        handleCancel = { this.closeGistEditorModal.bind(this) }
        onSubmit={ this.handleCreateSingleGist.bind(this) }></GistEditorForm>
    )
  }

  renderGistEditorModal () {
    return (
      <Modal
        bsSize='large'
        dialogClassName='new-modal'
        animation={ false }
        backdrop='static'
        show={ this.props.gistNewModalStatus === 'ON' }
        onHide={ this.closeGistEditorModal.bind(this)}>
        <Modal.Header closeButton>
          <Modal.Title>New Gist</Modal.Title>
        </Modal.Header>
        <Modal.Body>
          { this.renderGistEditorModalBody.bind(this)() }
        </Modal.Body>
      </Modal>
    )
  }

  renderInSection () {
    return (
      <div>
        { this.renderGistEditorModal() }
        <a href='#'
          className='customized-tag'
          onClick={ this.handleLogoutClicked.bind(this) }>
          #logout
        </a>
        <br/><br/>
        <a href='#'
          className='customized-tag'
          onClick={ this.handleNewGistClicked.bind(this) }>
          #new
        </a>
        <br/>
        <a href='#'
          className='customized-tag'
          onClick={ this.handleSyncClicked.bind(this) }>
          #sync
        </a>
        <div className='customized-tag-small'>{ this.props.syncTime }</div>
      </div>
    )
  }

  handleLogoutClicked () {
    this.props.updateLogoutModalStatus('ON')
  }

  handleNewGistClicked () {
    this.props.updateGistNewModeStatus('ON')
  }

  closeGistEditorModal () {
    this.props.updateGistNewModeStatus('OFF')
  }

  handleSyncClicked () {
    this.props.reSyncUserGists()
  }

  handleProfileImageClicked () {
    logger.debug('profile image is clicked!! ' + this.props.userSession.profile.html_url)
    shell.openExternal(this.props.userSession.profile.html_url)
  }

  handleLogoutModalCancelClicked () {
    this.props.updateLogoutModalStatus('OFF')
  }

  handleLogoutModalConfirmClicked () {
    logger.info('[Dispatch] logoutUserSession')
    this.props.updateLogoutModalStatus('OFF')
    this.props.logoutUserSession()
    this.props.updateLocalStorage({
      token: null,
      profile: null,
      image: null
    })
    removeAccessToken()
  }

  renderProfile () {
    const { profile, activeStatus } = this.props.userSession
    if (!profile || activeStatus === 'INACTIVE') {
      return
    }

    return (
      <div>
        <Image
            className='profile-image-section'
            src={ profile.avatar_url }
            onClick={ this.handleProfileImageClicked.bind(this) }
            rounded/>
      </div>
    )
  }

  renderLogoutConfirmationModal () {
    return (
        <div className='static-modal'>
          <Modal show={ this.props.logoutModalStatus === 'ON' } bsSize='small'>
            <Modal.Header>
              <Modal.Title>Confirm logout?</Modal.Title>
            </Modal.Header>
            <Modal.Footer>
              <Button onClick={ this.handleLogoutModalCancelClicked.bind(this) }>cancel</Button>
              <Button
                bsStyle='danger'
                onClick={ this.handleLogoutModalConfirmClicked.bind(this) }>logout</Button>
            </Modal.Footer>
          </Modal>
        </div>
    )
  }

  render () {
    return (
      <div className='user-panel'>
        <div>
          { this.renderProfile() }
          { this.props.gistSyncStatus === 'IN_PROGRESS'
              ? <ProgressBar className='resync-progress-bar' active now={ 100 }/>
              : null }
        </div>
        { this.renderInSection() }
        { this.renderLogoutConfirmationModal() }
      </div>
    )
  }
}

function mapStateToProps (state) {
  return {
    userSession: state.userSession,
    syncTime: state.syncTime,
    accessToken: state.accessToken,
    gistTags: state.gistTags,
    gistSyncStatus: state.gistSyncStatus,
    logoutModalStatus: state.logoutModalStatus,
    gistNewModalStatus: state.gistNewModalStatus
  }
}

function mapDispatchToProps (dispatch) {
  return bindActionCreators({
    logoutUserSession: logoutUserSession,
    updateSingleGist: updateSingleGist,
    updateGistTags: updateGistTags,
    selectGistTag: selectGistTag,
    selectGist: selectGist,
    updateGistNewModeStatus: updateGistNewModeStatus,
    updateLogoutModalStatus: updateLogoutModalStatus
  }, dispatch)
}

export default connect(mapStateToProps, mapDispatchToProps)(UserPanel)
